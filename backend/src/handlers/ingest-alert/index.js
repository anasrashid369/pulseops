const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { SchedulerClient, CreateScheduleCommand } = require("@aws-sdk/client-scheduler");
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { randomUUID } = require("crypto");
const { classifySeverity } = require("./triage");

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({});
const schedulerClient = new SchedulerClient({});

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
    const body = JSON.parse(event.body || "{}");
    const incidentId = randomUUID();
    const timestamp = new Date().toISOString();
    const message = body.message || "No message provided";

    let severity = "warning";
    let severityReason = "Default classification (AI triage unavailable)";
    try {
      const classification = await classifySeverity(message);
      severity = classification.severity;
      severityReason = classification.reason;
      console.log("Severity classified:", severity, "-", severityReason);
    } catch (triageError) {
      console.error("Triage classification failed, using default:", triageError);
    }

    const item = {
      incidentId,
      status: "open",
      message,
      timestamp,
      severity,
      severityReason,
      history: [{ status: "open", timestamp, note: `Incident created (severity: ${severity})` }],
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: item,
      })
    );

    try {
      await getFirebaseApp();
      const scheduleResult = await docClient.send(
        new GetCommand({
          TableName: process.env.ONCALL_TABLE_NAME,
          Key: { scheduleId: "default" },
        })
      );
      const schedule = scheduleResult.Item;
      const deviceToken =
        schedule?.rotation?.[schedule.currentIndex]?.deviceToken ||
        process.env.TEST_DEVICE_TOKEN;

      if (deviceToken) {
        const titlePrefix =
          item.severity === "critical" ? "🔴 CRITICAL" :
          item.severity === "warning" ? "🟡 WARNING" : "🔵 INFO";

        await getMessaging().send({
          notification: {
            title: `${titlePrefix}: New Incident`,
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
      console.error("Failed to send push notification:", pushError);
    }

    try {
      const scheduleTime = new Date(Date.now() + 60 * 1000);
      const isoTime = scheduleTime.toISOString().split(".")[0];
      await schedulerClient.send(
        new CreateScheduleCommand({
          Name: `escalate-${incidentId}`,
          ScheduleExpression: `at(${isoTime})`,
          FlexibleTimeWindow: { Mode: "OFF" },
          Target: {
            Arn: process.env.ESCALATE_FUNCTION_ARN,
            RoleArn: process.env.SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({ incidentId }),
          },
          ActionAfterCompletion: "DELETE",
        })
      );
      console.log("Escalation check scheduled for", scheduleTime.toISOString());
    } catch (scheduleError) {
      console.error("Failed to schedule escalation:", scheduleError);
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