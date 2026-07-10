const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { randomUUID } = require("crypto");

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({});

let firebaseApp;

async function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  const param = await ssmClient.send(
    new GetParameterCommand({
      Name: "/pulseops/fcm-service-account",
      WithDecryption: true,
    })
  );

  const serviceAccount = JSON.parse(param.Parameter.Value);

  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });

  return firebaseApp;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const incidentId = randomUUID();
    const timestamp = new Date().toISOString();

    const item = {
      incidentId,
      status: "open",
      message: body.message || "No message provided",
      timestamp,
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: item,
      })
    );

    // Send push notification
    try {
      await getFirebaseApp();
      const deviceToken = process.env.TEST_DEVICE_TOKEN;

      if (deviceToken) {
        await getMessaging().send({
          notification: {
            title: "New Incident",
            body: item.message,
          },
          data: {
            incidentId: item.incidentId,
          },
          token: deviceToken,
        });
        console.log("Push notification sent successfully");
      } else {
        console.log("No device token configured, skipping push");
      }
    } catch (pushError) {
      // Don't fail the whole request if push fails - incident is still recorded
      console.error("Failed to send push notification:", pushError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, incident: item }),
    };
  } catch (err) {
    console.error("Error ingesting alert:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};