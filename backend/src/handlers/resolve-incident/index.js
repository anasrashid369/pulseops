const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const incidentId = event.pathParameters.id;
    const ackTimestamp = new Date().toISOString();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { incidentId },
        UpdateExpression:
          "SET #status = :status, history = list_append(if_not_exists(history, :emptyList), :newEntry)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "acknowledged",
          ":emptyList": [],
          ":newEntry": [{ status: "acknowledged", timestamp: ackTimestamp, note: "Acknowledged by on-call" }],
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, incident: result.Attributes }),
    };
  } catch (err) {
    console.error("Error resolving incident:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};