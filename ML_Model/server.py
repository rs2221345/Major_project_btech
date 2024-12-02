import os
import absl.logging
import tensorflow as tf
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import cv2
import base64
import mediapipe as mp
from threading import Lock
from collections import deque, Counter

# Configure logging and TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
absl.logging.set_verbosity(absl.logging.ERROR)


labels = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] + list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + ['bye', 'delete', 'no', 'thankyou']

# Initialize MediaPipe Hands
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

app = Flask(__name__)
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# Global variables for model
interpreter = None

# Dictionary to store session states
sessions = {}

# Add thread lock for model predictions
model_lock = Lock()

class SessionState:
    def __init__(self):
        self.word = ""
        self.sentence = ""
        self.prediction_buffer = deque(maxlen=10)  # Reduced buffer size for faster response
        self.last_letter = None
        self.cooldown_counter = 0
        self.no_gesture_counter = 0
        self.stabilization_counter = 0
        
    def reset(self):
        self.word = ""
        self.sentence = ""
        self.prediction_buffer = deque(maxlen=10)
        self.last_letter = None
        self.cooldown_counter = 0
        self.no_gesture_counter = 0
        self.stabilization_counter = 0

# Helper function to get most common prediction
def get_most_common_prediction(predictions, min_confidence=5):
    """Returns the most common prediction if it meets the confidence threshold."""
    if not predictions:
        return None
    
    # Count occurrences of each prediction
    counts = Counter(predictions)
    most_common = counts.most_common(1)[0]  # Returns tuple (prediction, count)
    
    # Only return if we have minimum confidence
    if most_common[1] >= min_confidence:
        return most_common[0]
    return None
def initialize_model():
    global model
    model = tf.keras.models.load_model('./ML_Model/gesture_model_3d_balanced.h5')
    print("Model initialized successfully")
        
   
@app.route('/', methods=['GET'])
def test():
    return jsonify({'success': True, 'message': 'Server is running'})

@app.route('/test', methods=['GET'])
def test_server():
    return jsonify({'status': 'ok', 'message': 'Server is running'})

@app.route('/process-frame', methods=['POST'])
def process_frame():
    try:
        data = request.json
        session_id = data.get('sessionId', 'default')
        
        # Create new session if doesn't exist
        if session_id not in sessions:
            sessions[session_id] = SessionState()
            
        current_session = sessions[session_id]
            
        # Optimize image decoding
        try:
            frame_data = data['frame'].split(',')[1]
            nparr = np.frombuffer(base64.b64decode(frame_data), np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            frame = cv2.resize(frame, (320, 240))  # Smaller size for faster processing
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
        except Exception as e:
            print(f"Error decoding frame: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'Invalid frame data: {str(e)}'
            }), 400
            
        # Process with MediaPipe using thread lock
        with model_lock:
            result = hands.process(frame)
        print(result)
        if result.multi_hand_landmarks:
            for hand_landmarks in result.multi_hand_landmarks:
                # Optimize landmark extraction
                landmarks=[]
                for landmark in hand_landmarks.landmark:
                   landmarks.append([landmark.x,landmark.y,landmark.z])
                landmarks=np.array(landmarks).reshape(1,21,3)
                # Make prediction with thread lock
                with model_lock:
                    prediction = model.predict(landmarks)
                class_id = np.argmax(prediction)
                predicted_label = labels[class_id]
                
                # Add to prediction buffer
                current_session.prediction_buffer.append(predicted_label)
                
                # Get stable prediction
                final_prediction = get_most_common_prediction(
                    current_session.prediction_buffer, 
                    min_confidence=3  # Adjusted for faster response
                )
                
                if final_prediction:
                    return process_prediction(final_prediction, current_session)
        
        # Handle no gesture detected
        return process_prediction(None, current_session)

    except Exception as e:
        print(f"Error processing frame: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Separate prediction processing logic
def process_prediction(final_prediction, current_session):
    """Enhanced prediction processing with improved word formation logic."""
    # Handle no gesture detection
    if not final_prediction:
        current_session.no_gesture_counter += 1
        if current_session.no_gesture_counter > 10:  # Reduced threshold for faster response
            if current_session.word:
                current_session.sentence += current_session.word + ' '
                current_session.word = ''
            current_session.no_gesture_counter = 0
        return create_prediction_response(current_session, '')

    # Reset no gesture counter when gesture is detected
    current_session.no_gesture_counter = 0

    # Handle cooldown
    if current_session.cooldown_counter > 0:
        current_session.cooldown_counter -= 1
        return create_prediction_response(current_session, final_prediction)

    # Process new prediction
    if final_prediction != current_session.last_letter:
        if final_prediction == 'SPACE':
            current_session.sentence += current_session.word + ' '
            current_session.word = ''
        elif final_prediction == 'DELETE':
            if current_session.word:
                current_session.word = current_session.word[:-1]
        elif final_prediction == 'END':
            current_session.sentence += current_session.word + '. '
            current_session.word = ''
        else:
            # Stabilization check
            current_session.stabilization_counter += 1
            if current_session.stabilization_counter >= 2:  # Require 2 stable frames
                current_session.word += final_prediction
                current_session.last_letter = final_prediction
                current_session.cooldown_counter = 4  # Reduced cooldown for faster response
                current_session.stabilization_counter = 0
    else:
        current_session.stabilization_counter = 0

    return create_prediction_response(current_session, final_prediction)

# Helper function for creating prediction response
def create_prediction_response(session, prediction):
    return jsonify({
        'success': True,
        'prediction': {
            'word': session.word,
            'sentence': session.sentence,
            'letter': prediction
        }
    })

if __name__ == '__main__':
    try:
        # Initialize model
        initialize_model()
        print("Starting server...")
        
        # Check if SSL certificates exist
        cert_path = os.path.join(os.path.dirname(__file__), '..', 'server.cert')
        key_path = os.path.join(os.path.dirname(__file__), '..', 'server.key')
        
        if os.path.exists(cert_path) and os.path.exists(key_path):
            # Use SSL if certificates are present
            ssl_context = (cert_path, key_path)
            print("Starting server with SSL...")
        else:
            # Run without SSL if certificates are not found
            ssl_context = None
            print("Starting server without SSL...")
        
        # Start the Flask server
        app.run(
            host='0.0.0.0',
            port=5000,
            debug=False,
            ssl_context=ssl_context  # Temporarily disabled SSL
        )
    except Exception as e:
        print(f"Server failed to start: {str(e)}")
        import traceback
        traceback.print_exc()
    