import 'dart:convert';

class HealthRecord {
  final String id;
  final String title;
  final String description;
  final DateTime date;
  final String type; // 'diagnosis', 'checkup', 'blood_test'

  HealthRecord({
    required this.id,
    required this.title,
    required this.description,
    required this.date,
    required this.type,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'date': date.toIso8601String(),
      'type': type,
    };
  }

  factory HealthRecord.fromMap(Map<String, dynamic> map) {
    return HealthRecord(
      id: map['id'],
      title: map['title'],
      description: map['description'],
      date: DateTime.parse(map['date']),
      type: map['type'],
    );
  }

  String toJson() => json.encode(toMap());

  factory HealthRecord.fromJson(String source) =>
      HealthRecord.fromMap(json.decode(source));
}

class Medication {
  final String id;
  final String name;
  final String dosage;
  final String frequency; // e.g. "Daily", "Every 4 hours"
  final String timeOfDay; // e.g. "Morning", "8:00 AM"

  Medication({
    required this.id,
    required this.name,
    required this.dosage,
    required this.frequency,
    required this.timeOfDay,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'dosage': dosage,
      'frequency': frequency,
      'timeOfDay': timeOfDay,
    };
  }

  factory Medication.fromMap(Map<String, dynamic> map) {
    return Medication(
      id: map['id'],
      name: map['name'],
      dosage: map['dosage'],
      frequency: map['frequency'],
      timeOfDay: map['timeOfDay'],
    );
  }

  String toJson() => json.encode(toMap());

  factory Medication.fromJson(String source) =>
      Medication.fromMap(json.decode(source));
}
