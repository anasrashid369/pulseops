import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/incident.dart';

class ApiService {
  static const String baseUrl =
      "https://f3jpgy8v5j.execute-api.us-east-1.amazonaws.com/prod";

  Future<List<Incident>> fetchIncidents() async {
    final response = await http.get(Uri.parse("$baseUrl/alerts"));
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      final List<dynamic> items = data['incidents'] ?? [];
      return items.map((e) => Incident.fromJson(e)).toList();
    }
    throw Exception("Failed to load incidents");
  }

  Future<void> acknowledge(String incidentId) async {
    final url = Uri.parse("$baseUrl/alerts/$incidentId/ack");
    await http.post(url);
  }
}