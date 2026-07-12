const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

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
  firebaseApp = initializeApp({ credential: cert(serviceAccount) });
  return firebaseApp;
}

exports.handler = async (event) => {
  try {
    const targetIncidentId = event.incidentId;
    console.log("Checking escalation for incident:", targetIncidentId);

    const result = await docClient.send(
      new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { incidentId: targetIncidentId },
      })
    );

    const incident = result.Item;

    if (!incident) {
      console.log("Incident not found, skipping escalation");
      return { statusCode: 200, body: "Incident not found" };
    }

    if (incident.status !== "open") {
      console.log(`Incident already ${incident.status}, no escalation needed`);
      return { statusCode: 200, body: "No escalation needed" };
    }

    await getFirebaseApp();

    const scheduleResult = await docClient.send(
      new GetCommand({
        TableName: process.env.ONCALL_TABLE_NAME,
        Key: { scheduleId: "default" },
      })
    );
    const schedule = scheduleResult.Item;
    let backupToken = process.env.BACKUP_DEVICE_TOKEN;
    if (schedule?.rotation?.length > 1) {
      const nextIndex = (schedule.currentIndex + 1) % schedule.rotation.length;
      backupToken = schedule.rotation[nextIndex].deviceToken;
    }

    if (backupToken) {
      await getMessaging().send({
        notification: {
          title: "ESCALATED: Unacknowledged Incident",
          body: `${incident.message} (originally sent, no response)`,
        },
        data: { incidentId: targetIncidentId },
        token: backupToken,
      });
      console.log("Escalation push sent");
    }

    const escalatedAt = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { incidentId: targetIncidentId },
        UpdateExpression:
          "SET #status = :status, escalatedAt = :escalatedAt, history = list_append(if_not_exists(history, :emptyList), :newEntry)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "escalated",
          ":escalatedAt": escalatedAt,
          ":emptyList": [],
          ":newEntry": [{ status: "escalated", timestamp: escalatedAt, note: "No response, escalated to next on-call" }],
        },
      })
    );

    return { statusCode: 200, body: "Escalated" };
  } catch (err) {
    console.error("Error in escalation check:", err);
    return { statusCode: 500, body: err.message };
  }
};