import cv2
import mediapipe as mp
import speech_recognition as sr
import pyttsx3
import os
from groq import Groq
import numpy as np
import pyautogui as pag

# Ensure the API key is set correctly
api_key = os.environ.get("GROQ_API_KEY", "")

# Initialize Groq client
client = Groq(api_key=api_key)

# Initialize speech recognition and text-to-speech
recognizer = sr.Recognizer()
engine = pyttsx3.init()

# Initialize Mediapipe for hand tracking
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

# Activation phrase and shutdown command
activation_phrase = "Acera", "Asera", "Acara", "Assera" "Acra", "Asra"
shutdown_phrase = "shutdown", "shut down"
handtracking_phrase = "hand tracking", "gesture control", "gesture", "hands on mode"

# Function to handle Groq API call
def get_groq_response(input_text):
    chat_completion = client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": input_text,
            }
        ],
        model="llama3-8b-8192",
    )
    return chat_completion.choices[0].message.content

# Function to play audio
def play_audio(audio_data):
    engine.say(audio_data)
    engine.runAndWait()

# Function to listen for voice input
def listen_for_activation():
    with sr.Microphone() as source:
        recognizer.adjust_for_ambient_noise(source)
        print("Listening for activation phrase...")
        audio = recognizer.listen(source, timeout=15, phrase_time_limit=1000)

    try:
        transcript = recognizer.recognize_google(audio).lower()
        print(f"Transcript: {transcript}")
        return transcript
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as e:
        print(f"Could not request results; {e}")
        return ""

# Function to process hand tracking
class HandTrackingModule:
    def __init__(self):
        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(static_image_mode=False,
                                         max_num_hands=2,
                                         min_detection_confidence=0.1,
                                         min_tracking_confidence=0.1)
        self.mp_drawing = mp.solutions.drawing_utils
        self.cap = cv2.VideoCapture(0)  # Change the index if necessary
        if not self.cap.isOpened():
            print("Error: Camera Won't Open")
            exit()
        self.screen_width, self.screen_height = pag.size()
        self.mouseDown = False

    def process_frame(self):
        success, frame = self.cap.read()
        if not success:
            print("Failed to capture frame")
            return None

        frame = cv2.flip(frame, 1)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb_frame)
        frame_height, frame_width, _ = frame.shape

        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                self.mp_drawing.draw_landmarks(frame, hand_landmarks, self.mp_hands.HAND_CONNECTIONS)
                index_finger_tip = hand_landmarks.landmark[self.mp_hands.HandLandmark.INDEX_FINGER_TIP]
                thumb_tip = hand_landmarks.landmark[self.mp_hands.HandLandmark.THUMB_TIP]
                midpoint_x = (index_finger_tip.x + thumb_tip.x) / 2
                midpoint_y = (index_finger_tip.y + thumb_tip.y) / 2
                distance = np.sqrt((index_finger_tip.x - thumb_tip.x)**2 + (index_finger_tip.y - thumb_tip.y)**2)

                if distance < 0.05 and not self.mouseDown:
                    pag.mouseDown()
                    self.mouseDown = True
                elif distance > 0.1 and self.mouseDown:
                    pag.mouseUp()
                    self.mouseDown = False

                if self.mouseDown:
                    cv2.circle(frame, (int(midpoint_x * frame_width), int(midpoint_y * frame_height)), 10, (0, 255, 0), -1)
                else:
                    cv2.circle(frame, (int(midpoint_x * frame_width), int(midpoint_y * frame_height)), 10, (0, 255, 0), 1)

                x_mapped = np.interp(midpoint_x, (0, 1), (0, self.screen_width))
                y_mapped = np.interp(midpoint_y, (0, 1), (0, self.screen_height))
                pag.moveTo(x_mapped, y_mapped, duration=0.1)

        cv2.imshow("Mediapipe Hands", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            return None
        return frame

# Main function
def main():
    while True:
        transcript = listen_for_activation()

        if activation_phrase in transcript:
            play_audio("Yes, how can I help you?")

            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source)
                audio = recognizer.listen(source)

            try:
                query = recognizer.recognize_google(audio).lower()
                print(f"Query: {query}")

                if shutdown_phrase in query:
                    play_audio("Goodbye!")
                    break

                elif handtracking_phrase in query:
                    play_audio("Activating hand tracking.")
                    hand_tracking_module = HandTrackingModule()
                    # No initialize() needed, hand tracking starts immediately
                    while True:
                        frame = hand_tracking_module.process_frame()
                        if frame is None:
                            break
                else:
                    response = get_groq_response(query)
                    play_audio(response)
            except sr.UnknownValueError:
                play_audio("Sorry, I didn't catch that.")
            except sr.RequestError as e:
                play_audio(f"Could not request results; {e}")

if __name__ == "__main__":
    main()
