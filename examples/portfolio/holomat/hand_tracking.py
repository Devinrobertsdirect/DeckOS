import cv2
import mediapipe as mp
import pyautogui as pag
import numpy as np

class HandTrackingModule:
    def __init__(self):
        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(static_image_mode=False,
                                         max_num_hands=2,
                                         min_detection_confidence=0.1,
                                         min_tracking_confidence=0.1)
        self.mp_drawing = mp.solutions.drawing_utils
        self.cap = cv2.VideoCapture(1)
        if not self.cap.isOpened():
            print("Error: Camera Won't Open")
            exit()
        self.screen_width, self.screen_height = pag.size()
        self.mouseDown = False

    def process_frame(self):
        success, frame = self.cap.read()
        if not success:
            print("Failed to capture frame")
            return

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
                distance = np.sqrt((index_finger_tip.x - thumb_tip.x) ** 2 + (index_finger_tip.y - thumb_tip.y) ** 2)

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
            return

    def release(self):
        self.cap.release()
        cv2.destroyAllWindows()
