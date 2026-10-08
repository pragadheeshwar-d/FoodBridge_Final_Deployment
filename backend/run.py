import os

os.environ.setdefault('EVENTLET_NO_GREENDNS', 'yes')

import eventlet

eventlet.monkey_patch()

from app import create_app
from extensions import socketio

app = create_app()

if __name__ == '__main__':
    socketio.run(app, host='127.0.0.1', port=5000, debug=True, allow_unsafe_werkzeug=True)
