// var appInsights = require("applicationinsights");
// appInsights.setup("db8b2d10-212b-4e60-8af0-2482871ccf1d").start();
var net = require('net');
const publicIp = require('public-ip');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
var request = require('request');
const fs = require('fs');
const { RateLimiterMemory } = require('rate-limiter-flexible');
_ = require('lodash');

const { FILE } = require('dns');
const Console = console.constructor;
// redirect global console object to log file

function logfile (file) {
	var con = new Console(fs.createWriteStream(file));
	Object.keys(Console.prototype).forEach(function (name) {
		console[name] = function () {
			con[name].apply(con, arguments);
		};
	});
}

module.exports = logfile;

var Server = IgeClass.extend({
	classId: 'Server',
	Server: true,

	init: function (options) {
		var self = this;

		self.buildNumber = 466;

		self.status = 'stopped';
		self.totalUnitsCreated = 0;
		self.totalWallsCreated = 0;
		self.totalItemsCreated = 0;
		self.totalPlayersCreated = 0;
		self.totalProjectilesCreated = 0;
		self.started_at = new Date();
		self.lastSnapshot = [];

		self.logTriggers = {

		};

		self.isScriptLogOn = process.env.SCRIPTLOG == 'on';
		self.gameLoaded = false;
		self.coinUpdate = {};

		self.socketConnectionCount = {
			connected: 0,
			disconnected: 0,
			immediatelyDisconnected: 0
		};

		self.serverStartTime = new Date();// record start time

		self.bandwidthUsage = {
			unit: 0,
			debris: 0,
			item: 0,
			player: 0,
			projectile: 0,
			region: 0,
			sensor: 0
		};

		self.serverStartTime = new Date();// record start time		
		self.internalPingCount = 0;

		ige.debugEnabled(global.isDev);

		var rateLimiterOptions = {
			points: 20, // 6 points
			duration: 60 // Per second
		};
		ige.rateLimiter = new RateLimiterMemory(rateLimiterOptions);

		self.keysToRemoveBeforeSend = [
			'abilities', 'animations', 'bodies', 'body', 'cellSheet',
			'defaultData.rotation', 'defaultData.translate',
			'buffTypes', 'bonus', 'bulletStartPosition', 'canBePurchasedBy', 'carriedBy', 'damage',
			'description', 'handle', 'hits', 'inventoryImage', 'isGun', 'isStackable', 'maxQuantity',
			'texture', 'sound', 'states', 'frames', 'inventorySize', 'particles', 'price', 'skin',
			'variables', 'canBuyItem', 'canBePurchasedBy', 'inventoryImage', 'isPurchasable', 'oldState',
			'raycastCollidesWith', 'effects', 'defaultProjectile', 'currentBody',
			'penetration', 'bulletDistance', 'bulletType', 'ammoSize', 'ammo', 'ammoTotal', 'reloadRate',
			'recoilForce', 'fireRate', 'knockbackForce', 'canBeUsedBy', 'spawnChance', 'consumeBonus',
			'isConsumedImmediately', 'lifeSpan', 'removeWhenEmpty', 'spawnPosition', 'baseSpeed', 'bonusSpeed',
			'flip', 'fadingTextQueue', 'points', 'highscore', 'jointsOn', 'totalTime', 'email', 'isEmailVerified',
			'isUserAdmin', 'isUserMod', 'newHighscore', 'streamedOn', 'controls'
		];

		// for debugging reasons
		global.isServer = ige.isServer;

		self.startServer();
		self.start();
		self.startGame();
	},

	// start server
	start: function () {
		var self = this;
		
		if (self.gameLoaded) {
			console.log('Warning: Game already loaded in this server!!');
			return;
		}

		// Add the server-side game methods / event handlers
		this.implement(ServerNetworkEvents);
		ige.addComponent(IgeNetIoComponent);
	},

	loadGameJSON: function (gameUrl) {
		var self = this;

		return new Promise((resolve, reject) => {
			request(`${gameUrl}`, (error, response, body) => {
				if (response.statusCode == 200) {
					return resolve(JSON.parse(body));
				} else {
					console.log('LOADING GAME-JSON ERROR', response.statusCode, error, body);
					self.kill();
				} 
			});
		});
	},

	startServer: function () {
		const app = express();
		const webServerPort = 80; // http server port
		this.gameServerPort = 2000; // game server port

		app.set('view engine', 'ejs');
		app.set('views', path.resolve('src'));

		app.use('/engine', express.static(path.resolve('./engine/')));

		const FILES_TO_CACHE = [
			'pixi-legacy.js',
			'stats.js',
			'dat.gui.min.js',
			'msgpack.min.js'
		];
		const SECONDS_IN_A_WEEK = 7 * 24 * 60 * 60;
		app.use('/src', express.static(path.resolve('./src/'), {
			setHeaders: (res, path, stat) => {
				let shouldCache = FILES_TO_CACHE.some((filename) => path.endsWith(filename));

				// cache minified file
				shouldCache = shouldCache || path.endsWith('.min.js');

				if (shouldCache) {
					res.set('Cache-Control', `public, max-age=${SECONDS_IN_A_WEEK}`);
				}
			}
		}));

		app.use('/assets', express.static(path.resolve('./assets/'), { cacheControl: 7 * 24 * 60 * 60 * 1000 }));

		app.get('/', (req, res) => {
			if (ige.game) {
				const videoChatEnabled = ige.game.videoChatEnabled && req.protocol == 'https' ? ige.game.videoChatEnabled : false;

				const game = {
					_id: ige.game.data.defaultData._id,
					title: ige.game.data.defaultData.title,
					tier: ige.game.data.defaultData.tier,
					gameSlug: ige.game.data.defaultData.gameSlug,
					videoChatEnabled: videoChatEnabled
				};
				
				const options = {
					gameId: process.env.game,
					user: {},
					isOpenedFromIframe: false,
					gameSlug: game.gameSlug,
					referAccessDenied: true,
					ads: false,
					showSideBar: false,
					gameDetails: {
						name: game.title,
						tier: game.tier,
						gameSlug: game.gameSlug,
						videoChatEnabled: game.videoChatEnabled
					},
					highScores: null,
					hostedGames: null,
					currentUserScore: null,
					err: undefined,
					selectedServer: null,
					servers: [{
						ip: '127.0.0.1',
						port: 2000,
						playerCount: 0,
						maxPlayers: 32,
						acceptingPlayers: true
					}],
					menudiv: false,
					gameTitle: game.title,
					currentUserPresentInHighscore: false,
					discordLink: null,
					facebookLink: null,
					twitterLink: null,
					youtubeLink: null,
					androidLink: null,
					iosLink: null,
					share: {
						url: ''
					},
					domain: req.get('host'),
					version: Math.floor((Math.random() * 10000000) + 1),
					constants: {
						appName: 'Modd.io   ',
						appUrl: 'http://www.modd.io/',
						noAds: true,
						assetsProvider: ''
					},
					purchasables: null,
					timers: {
						smallChest: 0,
						bigChest: 0
					},
					ssl: process.env.ssl,
					env: process.env.env,
					analyticsUrl: '/'
				};

				return res.render('index.ejs', options);
			}
			
			
		});
		app.listen(webServerPort, () => console.log(`Web server listening on `+ ((process.env.ssl == 'on')?'https://':'http://') +`localhost:${webServerPort}`));
	},

	// run a specific game in this server
	startGame: function () {
		var self = this;

		this.socket = {};
		
		self.url = `http://${self.ip}:${self.gameServerPort}`;

		this.duplicateIpCount = {};
		this.bannedIps = [];

		self.maxPlayers = self.maxPlayers || 32;
		this.maxPlayersAllowed = self.maxPlayers || 32;

		console.log('maxPlayersAllowed', this.maxPlayersAllowed);
		
		// Define an object to hold references to our player entities
		this.clients = {};

		// Add the networking component
		ige.network.debug(self.isDebugging);
		
		// Start the network server
		ige.network.start(self.gameServerPort, function (data) {			
			var promise;			
			if (process.env.game) {
				console.log(`loading the game data from modd.io at https://www.modd.io/api/game-client/${process.env.game}`)
				var gameUrl = `https://www.modd.io/api/game-client/${process.env.game}/?source=gs`;
				promise = self.loadGameJSON(gameUrl);
			} else {
				console.log('loading the game data from game.json file')
				promise = new Promise(function (resolve, reject) {
					var game = fs.readFileSync(`${__dirname}/../src/game.json`);
					game = JSON.parse(game);
					game.defaultData = game;
					var data = { data: {} };
					for (let [key, value] of Object.entries(game)) {
						data.data[key] = value;
					}
					for (let [key, value] of Object.entries(game.data)) {
						data.data[key] = value;
					}
					resolve(data);
				});
			}

			promise.then((game) => {
				ige.addComponent(GameComponent);
				self.gameStartedAt = new Date();

				ige.game.data = game.data;
				ige.game.cspEnabled = !!ige.game.data.defaultData.clientSidePredictionEnabled;

				var baseTilesize = 64;

				// I'm assuming that both tilewidth and tileheight have same value
				// tilesize ratio is ratio of base tile size over tilesize of current map
				var tilesizeRatio = baseTilesize / game.data.map.tilewidth;

				var engineTickFrameRate = 15;
				// console.log(game.data.defaultData);
				if (game.data.defaultData && !isNaN(game.data.defaultData.frameRate)) {
					engineTickFrameRate = Math.max(15, Math.min(parseInt(game.data.defaultData.frameRate), 60)); // keep fps range between 15 and 60
				}

				// ige.setFps(engineTickFrameRate)
				ige._physicsTickRate = engineTickFrameRate;

				// Add physics and setup physics world
				ige.addComponent(PhysicsComponent)
					.physics.sleep(true)
					.physics.tilesizeRatio(tilesizeRatio);

				if (game.data.settings) {
					var gravity = game.data.settings.gravity;
					if (gravity) {
						console.log('setting gravity', gravity);
						ige.physics.gravity(gravity.x, gravity.y);
					}
				}

				ige.physics.createWorld();
				ige.physics.start();
				console.log('box2d world started');

				// console.log("game data", game)
				// mapComponent needs to be inside IgeStreamComponent, because debris' are created and streaming is enabled which requires IgeStreamComponent
				console.log('initializing components');

				ige.network.on('connect', self._onClientConnect);
				ige.network.on('disconnect', self._onClientDisconnect);

				// Networking has started so start the game engine
				ige.start(function (success) {
					// Check if the engine started successfully
					if (success) {
						
						self.defineNetworkEvents();
						// console.log("game data", ige.game.data.settings)

						// Add the network stream component
						ige.network.addComponent(IgeStreamComponent)
							.stream.sendInterval(1000 / engineTickFrameRate)
							.stream.start(); // Start the stream

						// Accept incoming network connections
						ige.network.acceptConnections(true);

						ige.addGraph('IgeBaseScene');

						ige.addComponent(MapComponent);
						ige.addComponent(ShopComponent);
						ige.addComponent(IgeChatComponent);
						ige.addComponent(ItemComponent);
						ige.addComponent(TimerComponent);
						ige.addComponent(TriggerComponent);
						ige.addComponent(VariableComponent);
						ige.addComponent(GameTextComponent);
						ige.addComponent(ScriptComponent);
						ige.addComponent(ConditionComponent);
						ige.addComponent(ActionComponent);
						ige.addComponent(AdComponent);
						ige.addComponent(SoundComponent);
						ige.addComponent(RegionManager);

						if (ige.game.data.defaultData.enableVideoChat) {
							ige.addComponent(VideoChatComponent);
						}

						let map = ige.scaleMap(_.cloneDeep(ige.game.data.map));
						ige.map.load(map);

						ige.game.start();

						self.gameLoaded = true;

						// send dev logs to developer every second
						var logInterval = setInterval(function () {
							// send only if developer client is connect
							if (ige.isServer && ((self.developerClientId && ige.server.clients[self.developerClientId]))) {
								ige.variable.devLogs.status = ige.server.getStatus();
								ige.network.send('devLogs', ige.variable.devLogs, self.developerClientId);

								if (ige.script.errorLogs != {}) {
									ige.network.send('errorLogs', ige.script.errorLogs, self.developerClientId);
									ige.script.errorLogs = {};
								}
							}
							// console.log(ige.physicsTickCount, ige.unitBehaviourCount)
							ige.physicsTickCount = 0;
							ige.unitBehaviourCount = 0;
						}, 1000);

					}
				});
			})
				.catch((err) => {
					console.log('got error while loading game json', err);
				});
		});
	},

	defineNetworkEvents: function () {
		var self = this;

		console.log('server.js: defineNetworkEvents');
		ige.network.define('joinGame', self._onJoinGameWrapper);
		ige.network.define('gameOver', self._onGameOver);

		ige.network.define('setStreamSendInterval', self._onSetStreamSendInterval);

		ige.network.define('makePlayerSelectUnit', self._onPlayerSelectUnit);
		ige.network.define('playerUnitMoved', self._onPlayerUnitMoved);
		ige.network.define('playerKeyDown', self._onPlayerKeyDown);
		ige.network.define('playerKeyUp', self._onPlayerKeyUp);
		ige.network.define('playerMouseMoved', self._onPlayerMouseMoved);
		ige.network.define('playerCustomInput', self._onPlayerCustomInput);
		ige.network.define('playerAbsoluteAngle', self._onPlayerAbsoluteAngle);
		ige.network.define('playerDialogueSubmit', self._onPlayerDialogueSubmit);

		ige.network.define('buyItem', self._onBuyItem);
		ige.network.define('buyUnit', self._onBuyUnit);
		ige.network.define('buySkin', self._onBuySkin);

		ige.network.define('equipSkin', self._onEquipSkin);
		ige.network.define('unEquipSkin', self._onUnEquipSkin);

		ige.network.define('swapInventory', self._onSwapInventory);

		// bullshit that's necessary for sending data to client
		ige.network.define('makePlayerCameraTrackUnit', self._onSomeBullshit);
		ige.network.define('changePlayerCameraPanSpeed', self._onSomeBullshit);

		ige.network.define('hideUnitFromPlayer', self._onSomeBullshit);
		ige.network.define('showUnitFromPlayer', self._onSomeBullshit);
		ige.network.define('hideUnitNameLabelFromPlayer', self._onSomeBullshit);
		ige.network.define('showUnitNameLabelFromPlayer', self._onSomeBullshit);

		ige.network.define('createPlayer', self._onSomeBullshit);
		ige.network.define('updateUiText', self._onSomeBullshit);
		ige.network.define('updateUiTextForTime', self._onSomeBullshit);
		ige.network.define('alertHighscore', self._onSomeBullshit);
		ige.network.define('addShopItem', self._onSomeBullshit);
		ige.network.define('removeShopItem', self._onSomeBullshit);
		ige.network.define('gameState', self._onSomeBullshit);

		// ige.network.define('updateEntity', self._onSomeBullshit);
		ige.network.define('updateEntityAttribute', self._onSomeBullshit);
		ige.network.define('updateAllEntities', self._onSomeBullshit);
		ige.network.define('teleport', self._onSomeBullshit);
		ige.network.define('itemHold', self._onSomeBullshit);
		ige.network.define('item', self._onSomeBullshit);
		ige.network.define('clientConnect', self._onSomeBullshit);
		ige.network.define('clientDisconnect', self._onSomeBullshit);
		ige.network.define('killStreakMessage', self._onSomeBullshit);
		ige.network.define('insertItem', self._onSomeBullshit);
		ige.network.define('playAd', self._onSomeBullshit);
		ige.network.define('ui', self._onSomeBullshit);
		ige.network.define('updateShopInventory', self._onSomeBullshit);
		ige.network.define('errorLogs', self._onSomeBullshit);
		ige.network.define('devLogs', self._onSomeBullshit);
		ige.network.define('sound', self._onSomeBullshit);
		ige.network.define('particle', self._onSomeBullshit);
		ige.network.define('camera', self._onSomeBullshit);
		ige.network.define('videoChat', self._onSomeBullshit);

		ige.network.define('gameSuggestion', self._onSomeBullshit);
		ige.network.define('minimap', self._onSomeBullshit);

		ige.network.define('createFloatingText', self._onSomeBullshit);

		ige.network.define('openShop', self._onSomeBullshit);
		ige.network.define('openDialogue', self._onSomeBullshit);
		ige.network.define('closeDialogue', self._onSomeBullshit);
		ige.network.define('userJoinedGame', self._onSomeBullshit);

		ige.network.define('kick', self._onKick);
		ige.network.define('ban-user', self._onBanUser);
		ige.network.define('ban-ip', self._onBanIp);
		ige.network.define('mutePlayer', self._onMutePlayer);

		ige.network.define('setOwner', self._setOwner);

		ige.network.define('trade', self._onTrade);
	},

	saveLastPlayedTime: function (data) {
		console.log('temp', data);
	},

	kill: function (log) {
		console.log("kill server called")
		console.trace();
		process.exit(0);
	},

	// get client with _id from BE
	getClientByUserId: function (_id) {
		var self = this;

		for (i in ige.server.clients) {
			if (ige.server.clients[i]._id == _id) {
				return ige.server.clients[i];
			}
		}
	},
	
	getStatus: function () {
		var self = this;

		var cpuDelta = null;
		if (ige._lastCpuUsage) {
			// console.log('before',ige._lastCpuUsage);
			cpuDelta = process.cpuUsage(ige._lastCpuUsage);
			ige._lastCpuUsage = process.cpuUsage();
		} else {
			ige._lastCpuUsage = cpuDelta = process.cpuUsage();
		}

		if (ige.physics && ige.physics.engine != 'CRASH') {
			// console.log('ige stream',ige.stream);

			var jointCount = 0;
			var jointList = ige.physics._world && ige.physics._world.getJointList();
			while (jointList) {
				jointCount++;
				jointList = jointList.getNext();
			}
			var returnData = {
				clientCount: Object.keys(ige.network._socketById).length,
				entityCount: {
					player: ige.$$('player').filter(function (player) { return player._stats.controlledBy == 'human'; }).length,
					unit: ige.$$('unit').length,
					item: ige.$$('item').length,
					debris: ige.$$('debris').length,
					projectile: ige.$$('projectile').length,
					sensor: ige.$$('sensor').length,
					region: ige.$$('region').length
				},
				bandwidth: self.bandwidthUsage,
				heapUsed: process.memoryUsage().heapUsed / 1024 / 1024,
				currentTime: ige._currentTime,
				physics: {
					engine: ige.physics.engine,
					bodyCount: ige.physics._world.m_bodyCount,
					contactCount: ige.physics._world.m_contactCount,
					jointCount: ige.physics._world.m_jointCount,
					stepDuration: ige.physics.avgPhysicsTickDuration.toFixed(2),
					stepsPerSecond: ige._physicsFPS,
					totalBodiesCreated: ige.physics.totalBodiesCreated
				},
				etc: {
					totalPlayersCreated: ige.server.totalPlayersCreated,
					totalUnitsCreated: ige.server.totalUnitsCreated,
					totalItemsCreated: ige.server.totalItemsCreated,
					totalProjectilesCreated: ige.server.totalProjectilesCreated,
					totalWallsCreated: ige.server.totalWallsCreated
				},
				cpu: cpuDelta,
				lastSnapshotLength: JSON.stringify(ige.server.lastSnapshot).length
			};

			self.bandwidthUsage = {
				unit: 0,
				debris: 0,
				item: 0,
				player: 0,
				projectile: 0,
				region: 0,
				sensor: 0
			};

			return returnData;
		}
	}
});

if (typeof (module) !== 'undefined' && typeof (module.exports) !== 'undefined') { module.exports = Server; }
