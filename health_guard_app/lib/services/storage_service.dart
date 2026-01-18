import 'package:shared_preferences/shared_preferences.dart';
import '../models/health_record.dart';
import '../models/check_in.dart';

class StorageService {
  static const String keyConditions = 'existing_conditions';
  static const String keyRecords = 'health_records';
  static const String keyMedications = 'medications';
  static const String keyCheckIns = 'check_ins';
  static const String keyDarkMode = 'is_dark_mode';
  static const String keyCheckInInterval = 'check_in_interval';

  // --- Settings ---
  Future<void> setDarkMode(bool isDark) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(keyDarkMode, isDark);
  }

  Future<bool> getDarkMode() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(keyDarkMode) ?? false;
  }

  Future<void> setCheckInInterval(int minutes) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(keyCheckInInterval, minutes);
  }

  Future<int> getCheckInInterval() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(keyCheckInInterval) ?? 60; // Default 1 hour
  }

  // --- Check-Ins ---
  Future<void> saveCheckIn(CheckIn checkIn) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> list = prefs.getStringList(keyCheckIns) ?? [];
    list.add(checkIn.toJson());
    await prefs.setStringList(keyCheckIns, list);
  }

  Future<List<CheckIn>> getCheckIns() async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> list = prefs.getStringList(keyCheckIns) ?? [];
    return list.map((e) => CheckIn.fromJson(e)).toList()
      ..sort((a, b) => b.timestamp.compareTo(a.timestamp)); // Newest first
  }

  // --- Conditions ---
  Future<void> saveCondition(String condition) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> conditions = prefs.getStringList(keyConditions) ?? [];
    if (!conditions.contains(condition)) {
      conditions.add(condition);
      await prefs.setStringList(keyConditions, conditions);
    }
  }

  Future<void> removeCondition(String condition) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> conditions = prefs.getStringList(keyConditions) ?? [];
    conditions.remove(condition);
    await prefs.setStringList(keyConditions, conditions);
  }

  Future<List<String>> getConditions() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(keyConditions) ?? [];
  }

  // --- Health Records (Diagnoses, Checkups, Blood Tests) ---
  Future<void> saveRecord(HealthRecord record) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> recordsJson = prefs.getStringList(keyRecords) ?? [];
    recordsJson.add(record.toJson());
    await prefs.setStringList(keyRecords, recordsJson);
  }

  Future<List<HealthRecord>> getRecords() async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> recordsJson = prefs.getStringList(keyRecords) ?? [];
    return recordsJson.map((e) => HealthRecord.fromJson(e)).toList()
      ..sort((a, b) => b.date.compareTo(a.date)); // Newest first
  }

  Future<void> deleteRecord(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> recordsJson = prefs.getStringList(keyRecords) ?? [];

    recordsJson.removeWhere((item) => HealthRecord.fromJson(item).id == id);
    await prefs.setStringList(keyRecords, recordsJson);
  }

  // --- Medications ---
  Future<void> saveMedication(Medication medication) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> medsJson = prefs.getStringList(keyMedications) ?? [];
    medsJson.add(medication.toJson());
    await prefs.setStringList(keyMedications, medsJson);
  }

  Future<List<Medication>> getMedications() async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> medsJson = prefs.getStringList(keyMedications) ?? [];
    return medsJson.map((e) => Medication.fromJson(e)).toList();
  }

  Future<void> deleteMedication(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> medsJson = prefs.getStringList(keyMedications) ?? [];

    medsJson.removeWhere((item) => Medication.fromJson(item).id == id);
    await prefs.setStringList(keyMedications, medsJson);
  }
}
