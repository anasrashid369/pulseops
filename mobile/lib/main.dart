import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';
import 'models/incident.dart';
import 'services/api_service.dart';

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
      theme: ThemeData(
        primarySwatch: Colors.indigo,
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF5F6FA),
      ),
      home: const IncidentListScreen(),
    );
  }
}

Color severityColor(String severity) {
  switch (severity) {
    case 'critical':
      return const Color(0xFFE53935);
    case 'warning':
      return const Color(0xFFFB8C00);
    case 'info':
    default:
      return const Color(0xFF1E88E5);
  }
}

IconData severityIcon(String severity) {
  switch (severity) {
    case 'critical':
      return Icons.error;
    case 'warning':
      return Icons.warning_amber_rounded;
    case 'info':
    default:
      return Icons.info_outline;
  }
}

Color statusColor(String status) {
  switch (status) {
    case 'open':
      return const Color(0xFFE53935);
    case 'escalated':
      return const Color(0xFF8E24AA);
    case 'acknowledged':
      return const Color(0xFF43A047);
    default:
      return Colors.grey;
  }
}

class IncidentListScreen extends StatefulWidget {
  const IncidentListScreen({super.key});

  @override
  State<IncidentListScreen> createState() => _IncidentListScreenState();
}

class _IncidentListScreenState extends State<IncidentListScreen> {
  final ApiService _api = ApiService();
  List<Incident> _incidents = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _setupNotifications();
    _loadIncidents();
  }

  Future<void> _setupNotifications() async {
    FirebaseMessaging messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);
    String? token = await messaging.getToken();
    print("FCM TOKEN: $token");

    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      _loadIncidents();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(message.notification?.title ?? "New incident"),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    });
  }

  Future<void> _loadIncidents() async {
    setState(() => _loading = true);
    try {
      final incidents = await _api.fetchIncidents();
      setState(() {
        _incidents = incidents;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _error = "Failed to load incidents";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("PulseOps", style: TextStyle(fontWeight: FontWeight.bold)),
        elevation: 0,
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadIncidents),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(
                  onRefresh: _loadIncidents,
                  child: _incidents.isEmpty
                      ? const Center(child: Text("No incidents yet"))
                      : ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: _incidents.length,
                          itemBuilder: (context, index) {
                            final incident = _incidents[index];
                            return IncidentCard(
                              incident: incident,
                              onTap: () async {
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => IncidentDetailScreen(incident: incident, api: _api),
                                  ),
                                );
                                _loadIncidents();
                              },
                            );
                          },
                        ),
                ),
    );
  }
}

class IncidentCard extends StatelessWidget {
  final Incident incident;
  final VoidCallback onTap;

  const IncidentCard({super.key, required this.incident, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = severityColor(incident.severity);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color.withOpacity(0.3), width: 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle),
                child: Icon(severityIcon(incident.severity), color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(incident.message,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: statusColor(incident.status).withOpacity(0.12),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            incident.status.toUpperCase(),
                            style: TextStyle(
                                color: statusColor(incident.status), fontSize: 10, fontWeight: FontWeight.bold),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(incident.severity.toUpperCase(),
                            style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.grey),
            ],
          ),
        ),
      ),
    );
  }
}

class IncidentDetailScreen extends StatefulWidget {
  final Incident incident;
  final ApiService api;

  const IncidentDetailScreen({super.key, required this.incident, required this.api});

  @override
  State<IncidentDetailScreen> createState() => _IncidentDetailScreenState();
}

class _IncidentDetailScreenState extends State<IncidentDetailScreen> {
  bool _acknowledging = false;

  Future<void> _acknowledge() async {
    setState(() => _acknowledging = true);
    try {
      await widget.api.acknowledge(widget.incident.incidentId);
      if (mounted) Navigator.pop(context);
    } finally {
      setState(() => _acknowledging = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final incident = widget.incident;
    final color = severityColor(incident.severity);

    return Scaffold(
      appBar: AppBar(title: const Text("Incident Details")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: color.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: color.withOpacity(0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(severityIcon(incident.severity), color: color),
                    const SizedBox(width: 8),
                    Text(incident.severity.toUpperCase(),
                        style: TextStyle(color: color, fontWeight: FontWeight.bold)),
                  ],
                ),
                if (incident.severityReason != null) ...[
                  const SizedBox(height: 8),
                  Text(incident.severityReason!, style: const TextStyle(fontSize: 13)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(incident.message, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text("ID: ${incident.incidentId}", style: const TextStyle(fontSize: 11, color: Colors.grey)),
          const SizedBox(height: 24),
          const Text("Timeline", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          ...incident.history.map((h) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      margin: const EdgeInsets.only(top: 4),
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(color: statusColor(h.status), shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(h.note, style: const TextStyle(fontWeight: FontWeight.w500)),
                          Text(h.timestamp, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                        ],
                      ),
                    ),
                  ],
                ),
              )),
          const SizedBox(height: 24),
          if (incident.status == 'open' || incident.status == 'escalated')
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _acknowledging ? null : _acknowledge,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF43A047),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: _acknowledging
                    ? const SizedBox(
                        height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text("ACKNOWLEDGE", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ),
        ],
      ),
    );
  }
}