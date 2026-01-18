import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';
import 'package:uuid/uuid.dart';
import '../config.dart';

/// The Solace Agent Mesh (SAM) Service.
/// This acts as the backbone for the Event Driven Architecture.
/// It connects to a Solace PubSub+ Broker or falls back to a local Event Bus.
class SolaceService {
  static final SolaceService _instance = SolaceService._internal();
  factory SolaceService() => _instance;

  MqttServerClient? _client;
  final StreamController<AgentEvent> _localBus = StreamController.broadcast();
  bool _useLocalMesh = true; // Default to local for prototype stability
  final String _clientId = const Uuid().v4();
  // Topic prefix ensures scalability/multi-tenancy so users don't collide on public broker
  late final String _topicPrefix = 'healthguard/users/$_clientId';

  SolaceService._internal();

  /// Initialize connection to Solace PubSub+
  Future<void> connect({
    String? brokerUrl,
    int port = 1883,
    String? username,
    String? password,
  }) async {
    // 1. Resolve Config if no args passed
    final String targetUrl = brokerUrl ?? Config.solaceBrokerUrl;
    final int targetPort = (brokerUrl == null) ? Config.solacePort : port;
    final String? user = username ?? Config.solaceUsername;
    final String? pass = password ?? Config.solacePassword;

    // Check availability
    if (targetUrl.isEmpty ||
        targetUrl.contains('YOUR_') ||
        targetUrl.contains('mr-connection')) {
      debugPrint(
        "SolaceService: No valid configuration found. Using Local Mesh.",
      );
      _useLocalMesh = true;
      return;
    }

    // Clean URL
    final host = targetUrl
        .replaceAll('tcps://', '')
        .replaceAll('tcp://', '')
        .replaceAll('ssl://', '');

    _client = MqttServerClient(host, _clientId);
    _client!.port = targetPort;
    _client!.logging(on: true); // Enable for debugging
    _client!.keepAlivePeriod = 20;
    _client!.onDisconnected = _onDisconnected;
    _client!.secure =
        targetUrl.startsWith('tcps') ||
        targetUrl.startsWith('ssl') ||
        targetPort == 8883;

    // Security context for Solace Cloud often requires accepting their CA or allowing anything
    if (_client!.secure) {
      _client!.securityContext.setClientAuthorities('X509');
      // For hackathon ease (avoid certificate bundle issues on mobile), we often do this (not prod safe):
      _client!.onBadCertificate = (dynamic cert) => true;
    }

    final connMessage = MqttConnectMessage()
        .withClientIdentifier(_clientId)
        .withWillTopic('$_topicPrefix/agent/status')
        .withWillMessage('disconnected')
        .startClean()
        .withWillQos(MqttQos.atLeastOnce);

    if (user != null && user.isNotEmpty) {
      connMessage.authenticateAs(user, pass);
    }

    _client!.connectionMessage = connMessage;

    try {
      debugPrint("SolaceService: Connecting to Solace Broker...");
      await _client!.connect();
      _useLocalMesh = false;
      debugPrint("SolaceService: Connected to Solace Mesh!");

      _client!.updates!.listen(_onMqttMessage);
    } catch (e) {
      debugPrint(
        "SolaceService: Connection failed ($e). Falling back to Local Mesh.",
      );
      _useLocalMesh = true;
    }
  }

  void _onDisconnected() {
    debugPrint("SolaceService: Disconnected from broker.");
  }

  /// Subscribe an Agent to a topic
  Stream<AgentEvent> subscribe(String topic) {
    if (_useLocalMesh) {
      return _localBus.stream.where((event) => _matchTopic(event.topic, topic));
    } else {
      // Subscribe to the namespaced topic
      final scopedTopic = (topic == '#')
          ? '$_topicPrefix/#'
          : '$_topicPrefix/$topic';

      _client!.subscribe(scopedTopic, MqttQos.atLeastOnce);

      // We filter the stream using the original short topic logic,
      // but because we scoped the subscription/publish, we need to inspect the original stripped topic?
      // Actually simpler: The _localBus logic below is used for both.
      // When MQTT message comes in (_onMqttMessage), we STRIP the prefix.
      return _localBus.stream.where((event) => _matchTopic(event.topic, topic));
    }
  }

  /// Publish a message to the Mesh
  void publish(String topic, Map<String, dynamic> payload) {
    final jsonString = jsonEncode(payload);

    debugPrint(
      "SAM [Event]: $topic -> ${jsonString.substring(0, jsonString.length.clamp(0, 50))}...",
    );

    // Always emit local for internal UI subscriptions so UI updates immediately
    _localBus.add(AgentEvent(topic, payload));

    if (!_useLocalMesh &&
        _client != null &&
        _client!.connectionStatus?.state == MqttConnectionState.connected) {
      final builder = MqttClientPayloadBuilder();
      builder.addString(jsonString);

      final scopedTopic = '$_topicPrefix/$topic';
      _client!.publishMessage(
        scopedTopic,
        MqttQos.atLeastOnce,
        builder.payload!,
      );
    }
  }

  void _onMqttMessage(List<MqttReceivedMessage<MqttMessage?>>? c) {
    final recMess = c![0].payload as MqttPublishMessage;
    final pt = MqttPublishPayload.bytesToStringAsString(
      recMess.payload.message,
    );
    final rawTopic = c[0].topic;

    // Strip prefix so internal agents see "patient/status" not "healthguard/uid/patient/status"
    String cleanTopic = rawTopic;
    if (rawTopic.startsWith('$_topicPrefix/')) {
      cleanTopic = rawTopic.substring(_topicPrefix.length + 1);
    }

    try {
      final payload = jsonDecode(pt);
      // We add to local bus with the cleaned topic
      _localBus.add(AgentEvent(cleanTopic, payload));
    } catch (e) {
      debugPrint("SolaceService: Error parsing message from $rawTopic");
    }
  }

  bool _matchTopic(String eventTopic, String subscriptionTopic) {
    if (subscriptionTopic == '#') return true;
    if (eventTopic == subscriptionTopic) return true;

    // Handle suffix wildcard (e.g. 'topic/#')
    if (subscriptionTopic.endsWith('/#')) {
      final prefix = subscriptionTopic.substring(
        0,
        subscriptionTopic.length - 2,
      );
      if (eventTopic.startsWith(prefix)) return true;
    }

    return false;
  }
}

class AgentEvent {
  final String topic;
  final Map<String, dynamic> payload;
  AgentEvent(this.topic, this.payload);
}
