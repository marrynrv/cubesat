import serial
import threading
import time
import json
import cv2
import numpy as np
import csv
import os
from flask import Flask, render_template, jsonify, Response, request

app = Flask(__name__)

SERIAL_PORT = "COM4"
BAUD_RATE = 9600
CSV_FILENAME = "GROUND_STATION_LOG.csv"

latest_telemetry = {
    "team_id": "ASTRA-ID-2026", "time": 0, "temp": 0.0, "pressure": 0.0,
    "altitude": 0.0, "descent_rate": 0.0, "lat": "0.000000", "lng": "0.000000", "gps_alt": 0.0,
    "battery": 0.0, "accX": 0.0, "accY": 0.0, "accZ": 9.81,
    "gyroX": 0.0, "gyroY": 0.0, "gyroZ": 0.0,
    "pitch": 0.0, "roll": 0.0, "yaw": 0.0, "sats": 0,
    "connected": False, "port": SERIAL_PORT,
    "iss_err01": "OK", "iss_err02": "OK", "iss_err03": "WAITING", "iss_err04": "OK"
}

telemetry_history = []
ser = None  # Global XBee serialport object.
serial_lock = threading.Lock()  # Lock for thread-safeserial access.

current_camera_source = 0  
current_frame = None
video_lock = threading.Lock()

def get_no_signal_frame():
    img = np.zeros((480, 640, 3), np.uint8)
    cv2.putText(img, "NO SIGNAL / SKYDROID ERROR", (80, 250), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2, cv2.LINE_AA)
    ret, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()

# -------------------------------------------------------------
# Video Capture thread (Camera / SKYDROID)
# -------------------------------------------------------------
def video_capture_thread():
    global current_camera_source, current_frame
    last_source = None
    camera = None

    while True:
        if current_camera_source != last_source:
            if camera is not None:
                camera.release()
            last_source = current_camera_source
            camera = cv2.VideoCapture(last_source)
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        if camera and camera.isOpened():
            success, frame = camera.read()
            if success:
                ret, buffer = cv2.imencode('.jpg', frame)
                if ret:
                    with video_lock:
                        current_frame = buffer.tobytes()
                time.sleep(0.03)
            else:
                with video_lock:
                    current_frame = None
                time.sleep(0.2)
        else:
            with video_lock:
                current_frame = None
            time.sleep(0.5)

def generate_video_frames():
    while True:
        with video_lock:
            frame_to_send = current_frame if current_frame is not None else get_no_signal_frame()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_to_send + b'\r\n')
        time.sleep(0.04)

# -------------------------------------------------------------
# CHECKING ISS ERRORS
# -------------------------------------------------------------
def check_iss_errors(data):
    alt = float(data.get("altitude", 0.0))
    speed = abs(float(data.get("descent_rate", 0.0)))
    
    if alt > 30.0 and speed > 1.0:
        data["iss_err01"] = "RED" if (speed < 6.0 or speed > 8.0) else "OK"
    else:
        data["iss_err01"] = "OK"

    lat = str(data.get("lat", "0.000000"))
    data["iss_err02"] = "RED" if (lat == "0.000000" or float(lat) == 0.0) else "OK"
    data["iss_err03"] = "OK" if alt >= 200.0 else "WAITING (<200m)"
    data["iss_err04"] = "OK" if data.get("connected", False) else "RED"

# -------------------------------------------------------------
# XBee telemetry  reader thread (COM4)
# -------------------------------------------------------------
def read_radio_xbee():
    global latest_telemetry, ser
    while True:
        try:
            with serial_lock:
                ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
            latest_telemetry["connected"] = True
            print(f"[XBEE SYSTEM] Successful connection to {SERIAL_PORT}")

            while True:
                if ser and ser.is_open:
                    if ser.in_waiting > 0:
                        with serial_lock:
                            raw_line = ser.readline().decode("ascii", errors="ignore").strip()
                        
                        if raw_line.startswith("{"):
                            try:
                                data = json.loads(raw_line)
                                data["connected"] = True
                                data["port"] = SERIAL_PORT
                                
                                check_iss_errors(data)
                                latest_telemetry = data
                                telemetry_history.append(data)
                            except json.JSONDecodeError:
                                continue

                        if len(telemetry_history) > 300:
                            telemetry_history.pop(0)

                time.sleep(0.01)

        except Exception as e:
            latest_telemetry["connected"] = False
            with serial_lock:
                if ser:
                    try:
                        ser.close()
                    except:
                        pass
                    ser = None
            time.sleep(2)

# -------------------------------------------------------------
# FLASK ROUTING
# -------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/data")
def get_data():
    return jsonify(latest_telemetry)

@app.route("/video_feed")
def video_feed():
    return Response(generate_video_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/api/select_camera", methods=["POST"])
def select_camera():
    global current_camera_source
    req_data = request.get_json()
    current_camera_source = int(req_data.get("index", 0))
    return jsonify({"status": "success", "source": current_camera_source})

# -------------------------------------------------------------
#  Send text to CubeSat for writing to ASTRA.sec
# -------------------------------------------------------------
@app.route("/api/send_message", methods=["POST"])
def send_message():
    global ser
    req_data = request.get_json()
    message = req_data.get("message", "").strip()

    if not message:
        return jsonify({"status": "error", "reason": "Пустое сообщение"}), 400

    #  If the client already sends the prefix CMD:MSG: by itself — we use it, otherwise adding it
    if message.startswith("CMD:MSG:"):
        payload = f"{message}\n"
    else:
        payload = f"CMD:MSG:{message}\n"

    if ser and ser.is_open:
        try:
            with serial_lock:
                # Sending data in utf-8  for better character handling
                ser.write(payload.encode("utf-8"))
                ser.flush()  #  Force buffered data to be transmitted by XBee
            
            print(f"[XBEE TX SUCCESS] Successfully transmitted to CubeSat.: {payload.strip()}")
            return jsonify({"status": "success"})
        except Exception as e:
            print(f"[XBEE TX ERROR] Serial port error: {e}")
            return jsonify({"status": "error", "reason": f"Error transmitting to XBee: {str(e)}"}), 500
    else:
        print(f"[XBEE TX ERROR] Port {SERIAL_PORT} is not connected!")
        return jsonify({"status": "error", "reason": f"Port {SERIAL_PORT} is not connected"}), 500

# -------------------------------------------------------------
# Server Startup
# -------------------------------------------------------------
if __name__ == "__main__":
    threading.Thread(target=read_radio_xbee, daemon=True).start()
    threading.Thread(target=video_capture_thread, daemon=True).start()
    app.run(host="0.0.0.0", port=5000, debug=False)