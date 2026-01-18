class Config {
  // --- AI Services ---
  static const String geminiApiKey = 'AIzaSyBzWPmoskvwoMVhvMdAp48pDdd0q2dQoIs';
  static const String elevenLabsApiKey =
      'sk_967bc0b9704a6af443aae951e3468d713603340d0269f7fd';

  // --- Solace Agent Mesh (PubSub+) ---
  // Sign up at https://console.solace.cloud/
  static const String solaceBrokerUrl =
      'tcps://mr-connection-h9lwi94iwxy.messaging.solace.cloud';
  static const int solacePort = 8883;
  static const String solaceUsername = 'solace-cloud-client';
  static const String solacePassword = 'tkju12e3mi9lthrudj9vjls2cm';

  // --- SurveyMonkey Integration ---
  // Get Access Token from https://developer.surveymonkey.com/apps/
  static const String surveyMonkeyAccessToken =
      'L-neD1lOdIqnwI-6M99uq15Cut2JJSk4wWjbYEEjR6h3g-W1ToB7KV6VjfitWoPrY9uPypfR4l7I6xS8RX40dOaqC2XJS3wj1S2Fx8YWq4plEhQHYkwieiQCNVppfRlY';
  static const String surveyMonkeyClientId = '5lHgvoh1Tsee5TRCzxIVFA';
  static const String surveyMonkeyClientSecret =
      '279616774698526728403690851456745212045';

  // --- Yellowcake (Web Extraction) ---
  // If the Hackathon API is hosted locally or at a specific IP, change this:
  static const String yellowcakeBaseUrl = 'https://api.yellowcake.dev/v1'; 
  static const String yellowcakeApiKey =
      'yc_live_o463Jqri8UbXCjSPXWk7rWaDwPR31mXjZzlBcdu4ikM=';

  // Optional: If you want to log data to a specific survey, otherwise it finds/creates one
  static const String surveyMonkeySurveyTitle = 'HealthGuard Patient Intake';
  static const String surveyMonkeyFeedbackTitle = 'HealthGuard App Feedback';
  static const String surveyMonkeySafetyTitle = 'HealthGuard Safety Log';
}
