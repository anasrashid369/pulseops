class HistoryEntry {
  final String status;
  final String timestamp;
  final String note;

  HistoryEntry({required this.status, required this.timestamp, required this.note});

  factory HistoryEntry.fromJson(Map<String, dynamic> json) {
    return HistoryEntry(
      status: json['status'] ?? '',
      timestamp: json['timestamp'] ?? '',
      note: json['note'] ?? '',
    );
  }
}

class Incident {
  final String incidentId;
  final String message;
  final String status;
  final String timestamp;
  final String severity;
  final String? severityReason;
  final String? escalatedAt;
  final List<HistoryEntry> history;

  Incident({
    required this.incidentId,
    required this.message,
    required this.status,
    required this.timestamp,
    required this.severity,
    this.severityReason,
    this.escalatedAt,
    required this.history,
  });

  factory Incident.fromJson(Map<String, dynamic> json) {
    return Incident(
      incidentId: json['incidentId'] ?? '',
      message: json['message'] ?? '',
      status: json['status'] ?? 'open',
      timestamp: json['timestamp'] ?? '',
      severity: json['severity'] ?? 'warning',
      severityReason: json['severityReason'],
      escalatedAt: json['escalatedAt'],
      history: (json['history'] as List<dynamic>? ?? [])
          .map((e) => HistoryEntry.fromJson(e))
          .toList(),
    );
  }
}