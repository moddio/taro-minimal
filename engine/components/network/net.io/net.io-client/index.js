// Our namespace
var NetIo = {};

/**
 * Define the debug options object.
 * @type {Object}
 * @private
 */
NetIo._debug = {
	_enabled: true,
	_node: typeof (module) !== 'undefined' && typeof (module.exports) !== 'undefined',
	_level: ['log', 'warning', 'error'],
	_stacks: false,
	_throwErrors: true,
	_trace: {
		setup: false,
		enabled: false,
		match: ''
	},
	enabled: function (val) {
		if (val !== undefined) {
			this._enabled = val;
			return this;
		}

		return this._enabled;
	}
};

/**
 * Define the class system.
 * @type {*}
 */
NetIo.Class = IgeClass;

NetIo.EventingClass = IgeEventingClass;

NetIo.Client = NetIo.EventingClass.extend({
	classId: 'NetIo.Client',

	init: function (url, options) {
		this.log('Net.io client starting...');

		this._options = options || {};
		this._socket = null;
		this._state = 0;
		this._debug = false;
		this._connectionAttempts = 0;

		this._sentBytesSinceLastUpdate = 0;
		this._sentBytesTotal = 0;
		this._receivedBytesSinceLastUpdate = 0;
		this._receivedBytesTotal = 0;
		this._started = new Date();
		this._lastSentUpdated = new Date();
		this._lastReceiveUpdated = new Date();
		this._receiveRate = 0;
		this._sendRate = 0;

		// this.COMPRESSION_THRESHOLD = 30000;

		// Set some default options
		if (this._options.connectionRetry === undefined) { this._options.connectionRetry = true; }
		if (this._options.connectionRetryMax === undefined) { this._options.connectionRetryMax = 10; }
		if (this._options.reconnect === undefined) { this._options.reconnect = true; }

		// If we were passed a url, connect to it
		if (url !== undefined) {
			console.log("netio client connecting to ", url)
			this.connect(url);
		}
	},

	/**
	 * Gets / sets the debug flag. If set to true, net.io
	 * will output debug data about every network event as
	 * it occurs to the console.
	 * @param {Boolean=} val
	 * @return {*}
	 */
	debug: function (val) {
		if (val !== undefined) {
			this._debug = val;
			return this;
		}

		return this._debug;
	},

	connect: function (url) {
		var self = this;

		// Create new websocket to the url
		this._socket = new WebSocket(`${url}`, 'netio1');

		// Setup event listeners
		this._socket.onmessage = function () { self._onData.apply(self, arguments); };
		this._socket.onerror = function () { self._onError.apply(self, arguments); };
	},

	disconnect: function (reason) {
		this._socket.close(1000, reason);
		this.emit('_igeStreamDestroy');
	},

	send: function (data) {
		if (this._socket.readyState == 1) {
			var str = this._encode(data);
			this._socket.send(str);

			// how many UTF8 characters did we send (assume 1 byte per char and mostly ascii)
			var sentBytes = str.length;
			this._sentBytesSinceLastUpdate += sentBytes;
			this._sentBytesTotal += sentBytes;

			// all time average
			var now = new Date();
			var elapsedSinceStarted = (now - this._started) * 0.001;
			this._averageSendRate = this._sentBytesTotal / elapsedSinceStarted;

			// average in last second
			var elapsed = (now - this._lastSentUpdated) * 0.001;
			if (elapsed >= 1) {
				this._sendRate = this._sentBytesSinceLastUpdate / elapsed;
				this._lastSentUpdated = now;
				this._sentBytesSinceLastUpdate = 0;
				// plot against 2x all time average
				if (statsPanels.sent) {
					statsPanels.sent._sentPanel.update(this._sendRate, this._averageSendRate * 2);
				}
			}
		} else {
			this.disconnect();
		}
	},

	_onData: function (data) {
		// Decode packet and emit message event
		this._decode(data);
	},

	_onDecode: function (packet, data) {
		// how many UTF8 characters did we receive (assume 1 byte per char and mostly ascii)
		// var receivedBytes = data.data.size;
		var receivedBytes = (data.data && data.data.length) || 0;
		this._receivedBytesSinceLastUpdate += receivedBytes;
		this._receivedBytesTotal += receivedBytes;

		// all time average
		var now = new Date();
		var elapsedSinceStarted = (now - this._started) * 0.001;
		this._averageReceiveRate = this._receivedBytesTotal / elapsedSinceStarted;

		// average in last second
		var elapsed = (now - this._lastReceiveUpdated) * 0.001;
		if (elapsed >= 1) {
			this._receiveRate = this._receivedBytesSinceLastUpdate / elapsed;
			this._lastReceiveUpdated = now;
			this._receivedBytesSinceLastUpdate = 0;
			// plot against 2x all time average
			if (statsPanels.received) {
				statsPanels.received._receivedPanel.update(this._receiveRate, this._averageReceiveRate * 2);
			}

			var bandwidthUsed = (this._receivedBytesTotal + this._sentBytesTotal) / 1024;
			if (statsPanels.bandwidth) {
				statsPanels.bandwidth._bandwidthPanel.update(bandwidthUsed, bandwidthUsed * 2);
			}
		}

		// Output debug if required
		if (this._debug) {
			console.log('Incoming data (event, decoded data):', data, packet);
		}

		if (packet._netioCmd) {
			// The packet is a netio command
			switch (packet._netioCmd) {
				case 'id':
					// Store the new id in the socket
					this.id = packet.data;

					// Now we have an id, set the state to connected
					// Emit the connect event

					this.emit('connect', this.id);
					break;

				case 'close':
					// The server told us our connection has been closed
					// so store the reason the server gave us!
					this._disconnectReason = packet.data;
					break;
			}
		} else {
			// The packet is normal data
			this.emit('message', [packet]);
		}
	},

	_onError: function () {
		this.log('An error occurred with the net.io socket!', 'error', arguments);
		console.log('An error occurred with the net.io socket!', 'error', arguments);
		this.emit('error', arguments);
	},

	_encode: function (data) {
		return JSON.stringify(data);
	},

	_decode: function (data) {
		var self = this;

		var jsonString = LZString.decompressFromUTF16(data.data);
		// var jsonString = data.data;

		// NOTE: make sure than COMPRESSION_THRESHOLD is same on both client and server
		// LOGIC:
		//     1. if json string has less than COMPRESSION_THRESHOLD chars (e.g. 9998)
		//        then it was compressed on server side so decompress it
		//        (because we are comparing with COMPRESSION_THRESHOLD before compressing it)
		//     2. if json string has more than COMPRESSION_THRESHOLD chars (10001)
		//        then it was not compressed on server side so don't run decompression on it
		//        and just parse the data as is

		// var jsonString = data.data.length > self.COMPRESSION_THRESHOLD
		// 	? data.data
		// 	: LZString.decompressFromUTF16(data.data);

		self._onDecode(JSON.parse(jsonString), data);
		// self._onDecode(JSON.parse(data.data), data);
		// var blob = data.data;
		// var fileReader = new FileReader();
		// fileReader.onload = function () {
		// 	arrayBuffer = this.result;
		// 	var uint8Array = new Uint8Array(arrayBuffer);
		// 	//console.log(uint8Array);
		// 	var packet = msgpack.decode(uint8Array);
		// 	//console.log(packet);
		// 	self._onDecode(packet, data);
		// };
		// fileReader.readAsArrayBuffer(blob);
	}
});
