import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'firebase_options.dart';

// This must be a top-level function (not inside a class)
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  print('Handling a background message: ${message.messageId}');
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
  runApp(const PulseOpsApp());
}

class PulseOpsApp extends StatelessWidget {
  const PulseOpsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PulseOps',
      theme: ThemeData(primarySwatch: Colors.red, useMaterial3: true),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String? _fcmToken;
  String? _lastIncidentId;
  String _status = "Waiting for setup...";

  // Replace with your actual API URL
  final String apiBaseUrl = "https://f3jpgy8v5j.execute-api.us-east-1.amazonaws.com/prod";

  @override
  void initState() {
    super.initState();
    _setupNotifications();
  }

  Future<void> _setupNotifications() async {
    FirebaseMessaging messaging = FirebaseMessaging.instance;

    // Ask permission (required on iOS, harmless no-op-ish on Android)
    await messaging.requestPermission(alert: true, badge: true, sound: true);

    // Get the device token — this is what you'll use to send a test push
    String? token = await messaging.getToken();
    setState(() {
      _fcmToken = token;
      _status = "Ready. Token acquired.";
    });
    print("FCM TOKEN: $token"); // also print to console/logs

    // Listen for foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      setState(() {
        _lastIncidentId = message.data['incidentId'];
        _status = "New alert: ${message.notification?.title ?? message.data['message']}";
      });
    });
  }

  Future<void> _acknowledge() async {
    if (_lastIncidentId == null) {
      setState(() => _status = "No incident to acknowledge yet.");
      return;
    }
    final url = Uri.parse("$apiBaseUrl/alerts/$_lastIncidentId/ack");
    final response = await http.post(url);
    setState(() {
      _status = response.statusCode == 200
          ? "Acknowledged incident $_lastIncidentId"
          : "Failed to acknowledge (${response.statusCode})";
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("PulseOps")),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Status: $_status", style: const TextStyle(fontSize: 16)),
            const SizedBox(height: 20),
            const Text("FCM Device Token:", style: TextStyle(fontWeight: FontWeight.bold)),
            SelectableText(_fcmToken ?? "Loading..."),
            const SizedBox(height: 40),
            Center(
              child: ElevatedButton(
                onPressed: _acknowledge,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                ),
                child: const Text("ACKNOWLEDGE", style: TextStyle(fontSize: 18, color: Colors.white)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}