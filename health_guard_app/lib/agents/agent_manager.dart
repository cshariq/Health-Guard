import 'triage_agent.dart';
import 'survey_agent.dart';
import 'diagnosis_agent.dart';
import '../services/solace_service.dart';

class AgentManager {
  static final AgentManager _instance = AgentManager._internal();
  factory AgentManager() => _instance;

  TriageAgent? _triage;
  SurveyAgent? _survey;
  DiagnosisAgent? _diagnosis;

  AgentManager._internal();

  void initAgents() {
    // Initiate Solace Connection
    SolaceService().connect();

    _triage = TriageAgent();
    _survey = SurveyAgent();
    _diagnosis = DiagnosisAgent();
    print("HealthGuard Agent Mesh Initialized.");
  }
}
