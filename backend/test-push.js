const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const serviceAccount = require("./pulseops-666-firebase-adminsdk-fbsvc-3e640e7cdb.json");

initializeApp({
  credential: cert(serviceAccount),
});

const deviceToken = "eGQuj4deQtWirYJokaZFA8:APA91bFcNYA-NkQ-h45PV7kEZpnxWNwma82YkLSwLisEgONDD95jgNXXQL0DXoOGP7u-FldMKmVOAKU4PN9zHcWBKfaOwz8nNKIPwRSR2ZiOpkdcQ9FVq74";

const message = {
  notification: {
    title: "Test Alert",
    body: "PulseOps test push — backend to device",
  },
  token: deviceToken,
};

getMessaging()
  .send(message)
  .then((response) => {
    console.log("Successfully sent message:", response);
  })
  .catch((error) => {
    console.error("Error sending message:", error);
  });