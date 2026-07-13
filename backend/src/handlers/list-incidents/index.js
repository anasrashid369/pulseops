const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: process.env.TABLE_NAME,
      })
    );

    const incidents = (result.Items || []).sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, incidents }),
    };
  } catch (err) {
    console.error("Error listing incidents:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};