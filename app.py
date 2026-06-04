import os
import uuid

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "landrop")

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading"
)

online_devices = {}


@app.route("/")
def home():
    return render_template("index.html")


@socketio.on("go-online")
def go_online(data):
    device_id = data.get("deviceId") or str(uuid.uuid4())
    device_name = data.get("deviceName", "Unknown Device")

    online_devices[device_id] = {
        "deviceId": device_id,
        "deviceName": device_name,
        "socketId": request.sid
    }

    emit("device-id", {"deviceId": device_id})
    broadcast_devices()


@socketio.on("request-connect")
def request_connect(data):
    target_device_id = data["targetDeviceId"]
    sender_device = data["senderDevice"]

    target = online_devices.get(target_device_id)

    if not target:
        return

    sender_device["socketId"] = request.sid

    emit(
        "incoming-connect",
        sender_device,
        to=target["socketId"]
    )


@socketio.on("accept-connect")
def accept_connect(data):
    requester_socket_id = data["requesterSocketId"]
    room_id = data["roomId"]

    emit(
        "connect-accepted",
        {"roomId": room_id},
        to=requester_socket_id
    )


@socketio.on("join-transfer-room")
def join_transfer_room(data):
    join_room(data["roomId"])
    return {"joined": True}


@socketio.on("signal")
def signal(data):
    emit(
        "signal",
        data["signal"],
        room=data["roomId"],
        include_self=False
    )


@socketio.on("disconnect")
def disconnect():
    disconnected_id = None

    for device_id, device in list(online_devices.items()):
        if device["socketId"] == request.sid:
            disconnected_id = device_id
            break

    if disconnected_id:
        del online_devices[disconnected_id]
        broadcast_devices()


def broadcast_devices():
    devices = [
        {
            "deviceId": d["deviceId"],
            "deviceName": d["deviceName"]
        }
        for d in online_devices.values()
    ]

    socketio.emit("devices-updated", devices)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))

    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=False,
        allow_unsafe_werkzeug=True
    )