import tensorflow as tf
import numpy as np
import cv2
import json
import os

def create_model():
    # Recreate your model architecture here
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(42,)),  # Adjust input shape as needed
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(36, activation='softmax')  # Change this to 36 units
    ])
    return model

def load_model():
    # Define the base path
    base_path = r"C:\Users\rs222\OneDrive\Desktop\Major_Project\LAN-Video-Call-With-Sign-Language-Detection"
    
    # Path to the model.json file
    model_json_path = os.path.join(base_path, "ml_model", "sign_language_model", "model.json")
    
    # Path to the weights.bin file
    weights_path = os.path.join(base_path, "ml_model", "sign_language_model", "weights.bin")
    
    # Load the model architecture from JSON file
    with open(model_json_path, 'r') as json_file:
        loaded_model_json = json_file.read()
    
    model = tf.keras.models.model_from_json(loaded_model_json)
    
    # Load weights
    model.load_weights(weights_path)
    
    return model

def preprocess_image(img):
    # Resize the image to 42x1 pixels
    img = cv2.resize(img, (1, 42))
    
    # Convert to grayscale if your model expects a single channel
    img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Normalize pixel values
    img = img.astype(np.float32) / 255.0
    
    # Reshape to match the model's expected input shape
    img = np.reshape(img, (1, 42))
    
    return img

def predict_sign(model, preprocessed_img):
    prediction = model.predict(preprocessed_img)
    predicted_class_index = np.argmax(prediction[0])
    
    # Update this list to match your model's output classes (36 classes)
    signs = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] + list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    predicted_sign = signs[predicted_class_index]
    
    return predicted_sign
