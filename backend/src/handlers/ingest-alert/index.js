const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { randomUUID } = require("crypto");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

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

    // TODO Step 8: call FCM here to send push notification

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