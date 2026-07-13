import cv2
import time
import csv
import os
import numpy as np
import matplotlib.pyplot as plt
from ultralytics import YOLO

# --------------------------------------------------
# Configuration
# --------------------------------------------------
CONFIDENCE_THRESHOLD = 0.5
OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

EVENT_LOG = os.path.join(OUTPUT_DIR, "room_events.csv")
OCCUPANCY_LOG = os.path.join(OUTPUT_DIR, "occupancy_samples.csv")
SUMMARY_LOG = os.path.join(OUTPUT_DIR, "person_summary.csv")

# --------------------------------------------------
# Logging Helpers
# --------------------------------------------------
def write_csv_row(path, row):
    file_exists = os.path.isfile(path)
    with open(path, "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(row)

# headers
if not os.path.exists(EVENT_LOG):
    write_csv_row(EVENT_LOG, ["timestamp", "event", "person_id", "duration_sec"])

if not os.path.exists(OCCUPANCY_LOG):
    write_csv_row(OCCUPANCY_LOG, ["timestamp", "occupancy"])

# --------------------------------------------------
# Centroid Tracker
# --------------------------------------------------
class CentroidTracker:
    def __init__(self, max_disappeared=30):
        self.next_id = 0
        self.objects = {}
        self.disappeared = {}
        self.entry_time = {}
        self.positions = {}
        self.max_disappeared = max_disappeared

    def register(self, centroid):
        oid = self.next_id
        self.objects[oid] = centroid
        self.disappeared[oid] = 0
        self.entry_time[oid] = time.time()
        self.positions[oid] = [centroid]

        log_event("ENTER", oid, 0)
        self.next_id += 1

    def deregister(self, oid):
        duration = time.time() - self.entry_time[oid]

        path = np.array(self.positions[oid])
        distance = np.sum(np.linalg.norm(np.diff(path, axis=0), axis=1)) if len(path) > 1 else 0
        avg_speed = distance / duration if duration > 0 else 0

        write_csv_row(SUMMARY_LOG,
                      [oid, round(duration,2), round(distance,2), round(avg_speed,2)])

        log_event("EXIT", oid, duration)

        del self.objects[oid]
        del self.disappeared[oid]
        del self.entry_time[oid]
        del self.positions[oid]

    def update(self, rects):
        if len(rects) == 0:
            for oid in list(self.disappeared.keys()):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self.deregister(oid)
            return self.objects

        input_centroids = np.array([
            ((x1+x2)//2, (y1+y2)//2) for (x1,y1,x2,y2) in rects
        ])

        if len(self.objects) == 0:
            for c in input_centroids:
                self.register(c)
            return self.objects

        object_ids = list(self.objects.keys())
        object_centroids = list(self.objects.values())

        D = np.linalg.norm(
            np.array(object_centroids)[:,None] - input_centroids,
            axis=2
        )

        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows, used_cols = set(), set()

        for r,c in zip(rows, cols):
            if r in used_rows or c in used_cols:
                continue

            oid = object_ids[r]
            self.objects[oid] = input_centroids[c]
            self.positions[oid].append(input_centroids[c])
            self.disappeared[oid] = 0

            used_rows.add(r)
            used_cols.add(c)

        unused_rows = set(range(D.shape[0])) - used_rows
        unused_cols = set(range(D.shape[1])) - used_cols

        for r in unused_rows:
            oid = object_ids[r]
            self.disappeared[oid] += 1
            if self.disappeared[oid] > self.max_disappeared:
                self.deregister(oid)

        for c in unused_cols:
            self.register(input_centroids[c])

        return self.objects

# --------------------------------------------------
# Event Logging
# --------------------------------------------------
def log_event(event, oid, duration):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {event} Person {oid}")
    write_csv_row(EVENT_LOG, [timestamp, event, oid, round(duration,2)])

# --------------------------------------------------
# Load Model
# --------------------------------------------------
model = YOLO("yolov8n.pt")
names = model.names

cap = cv2.VideoCapture(0)
tracker = CentroidTracker()

heatmap = None
occupancy_history = []

prev_time = time.time()

# --------------------------------------------------
# Main Loop
# --------------------------------------------------
while True:
    ret, frame = cap.read()
    if not ret:
        break

    if heatmap is None:
        heatmap = np.zeros(frame.shape[:2], dtype=np.float32)

    results = model(frame)[0]
    detections = results.boxes.data.tolist()

    boxes = []

    for det in detections:
        x1,y1,x2,y2,conf,cls = det

        if conf < CONFIDENCE_THRESHOLD:
            continue

        if names[int(cls)] != "person":
            continue

        boxes.append((int(x1),int(y1),int(x2),int(y2)))

        cx, cy = (int((x1+x2)/2), int((y1+y2)/2))
        heatmap[cy, cx] += 1

        cv2.rectangle(frame,(int(x1),int(y1)),
                      (int(x2),int(y2)),(0,255,0),2)

    objects = tracker.update(boxes)

    # occupancy tracking
    occupancy = len(objects)
    occupancy_history.append(occupancy)
    write_csv_row(OCCUPANCY_LOG,
                  [time.strftime("%H:%M:%S"), occupancy])

    # FPS
    current_time = time.time()
    fps = 1/(current_time-prev_time)
    prev_time = current_time

    cv2.putText(frame,f"Occupancy: {occupancy}",(10,30),
                cv2.FONT_HERSHEY_SIMPLEX,0.7,(0,255,0),2)

    cv2.putText(frame,f"FPS: {fps:.1f}",(10,60),
                cv2.FONT_HERSHEY_SIMPLEX,0.7,(0,255,0),2)

    cv2.imshow("Smart Room Monitor",frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# --------------------------------------------------
# Save Analytics
# --------------------------------------------------
cap.release()
cv2.destroyAllWindows()

plt.figure()
plt.plot(occupancy_history)
plt.title("Room Occupancy Over Time")
plt.xlabel("Frame")
plt.ylabel("People Count")
plt.savefig(os.path.join(OUTPUT_DIR,"occupancy_timeline.png"))

heatmap_norm = cv2.normalize(heatmap,None,0,255,cv2.NORM_MINMAX)
heatmap_color = cv2.applyColorMap(
    heatmap_norm.astype(np.uint8),
    cv2.COLORMAP_JET
)

cv2.imwrite(os.path.join(OUTPUT_DIR,"movement_heatmap.png"),
            heatmap_color)

print("Analytics saved to /output")
