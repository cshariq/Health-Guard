import '../services/solace_service.dart';

abstract class BaseAgent {
  final String agentId;
  final SolaceService _solace = SolaceService();

  BaseAgent(this.agentId) {
    print("Agent $agentId initialized and connecting to Mesh...");
    initialize();
  }

  void initialize();

  void subscribe(String topic, Function(Map<String, dynamic>) onMessage) {
    _solace.subscribe(topic).listen((event) {
      onMessage(event.payload);
    });
  }

  void publish(String topic, Map<String, dynamic> payload) {
    _solace.publish(topic, payload);
  }
}
