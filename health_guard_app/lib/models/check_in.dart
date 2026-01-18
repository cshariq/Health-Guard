import 'dart:convert';

class CheckIn {
  final String id;
  final DateTime timestamp;
  final double latitude;
  final double longitude;
  final String locationName;
  final String userName; // "Me", "Mom", "Dad"
  final bool isAlert; // True if it's an SOS

  CheckIn({
    required this.id,
    required this.timestamp,
    required this.latitude,
    required this.longitude,
    required this.locationName,
    required this.userName,
    this.isAlert = false,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'timestamp': timestamp.toIso8601String(),
      'latitude': latitude,
      'longitude': longitude,
      'locationName': locationName,
      'userName': userName,
      'isAlert': isAlert,
    };
  }

  factory CheckIn.fromMap(Map<String, dynamic> map) {
    return CheckIn(
      id: map['id'],
      timestamp: DateTime.parse(map['timestamp']),
      latitude: map['latitude'],
      longitude: map['longitude'],
      locationName: map['locationName'],
      userName: map['userName'],
      isAlert: map['isAlert'] ?? false,
    );
  }

  String toJson() => json.encode(toMap());

  factory CheckIn.fromJson(String source) =>
      CheckIn.fromMap(json.decode(source));
}
