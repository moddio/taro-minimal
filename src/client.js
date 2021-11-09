showAllLayers = false;
curLayerPainting = "floor";

$(document).mousedown(function () {
    mouseIsDown = true;
}).mouseup(function () {
    mouseIsDown = false;
});

var statsPanels = {};

var Client = IgeClass.extend({
    classId: 'Client',

    init: function () {

        var self = this;
        self.data = [];
        self.previousScore = 0;
        self.loadedTextures = {};

        console.log("var getUrl ", window.location.hostname)

        self.entityUpdateQueue = {};
        self.errorLogs = [];
        self.tickAndUpdateData = {};

        pathArray = window.location.href.split('/');
       
        self.scenesLoaded = $.Deferred();
        self.configLoaded = $.Deferred();
        self.mapLoaded = $.Deferred();
        self.texturesLoaded = $.Deferred();
        self.mapRenderEnabled = true;
        self.unitRenderEnabled = true;
        self.itemRenderEnabled = true;
        self.uiEntityRenderEnabled = true;
        self.clearEveryFrame = true;
        self.cameraEnabled = true;
        self.ctxAlphaEnabled = true;
        self.viewportClippingEnabled = true;
        self.extrapolation = false; //disabeling due to item bug
        self.resolution = 0; // autosize
        self.scaleMode = 0; // none
        self.isActiveTab = true;
        self._trackTranslateSmoothing = 15;
        self.inactiveTabEntityStream = [];
        self.eventLog = [];

        self.fontTexture = new IgeFontSheet('/assets/fonts/verdana_12pt.png');

        self.cellSheets = {};
        self.allowTickAndUpdate = [
            'baseScene',
            'vpMiniMap',
            'minimapScene',
            'objectScene',
            'rootScene',
            'uiScene',
            'vp1',
            'tilelayer'
        ]
        self.keysToAddBeforeRender = [
            "abilities", "animations", "bodies", "bonus",
            "cellSheet", "sound", "states",
            "inventorySize", "particles", "price",
            "skin", "variables", "canBuyItem",
            "canBePurchasedBy", "inventoryImage", "isPurchasable",
            "bulletStartPosition", "canBePurchasedBy", "carriedBy",
            "damage", "description", "handle", "hits",
            "inventoryImage", "isGun", "isStackable", "deployMethod",
            "maxQuantity", "texture", "raycastCollidesWith", "effects",
            'penetration', "bulletDistance", "bulletType", "ammoSize", "ammo", "ammoTotal",
            "reloadRate", "recoilForce", "fireRate", "knockbackForce", "canBeUsedBy", "spawnChance",
            "consumeBonus", "isConsumedImmediately", "type", "lifeSpan", "removeWhenEmpty", "spawnPosition",
            "baseSpeed", "bonusSpeed", "controls"
        ];

        self.tradeOffers = [undefined, undefined, undefined, undefined, undefined]

        self.implement(ClientNetworkEvents);
        
        //register error log modal btn;
        $('#dev-error-button').on('click', function () {
            $('#error-log-modal').modal('show');
        });

        $('#bandwidth-usage').on('click', function () {
            $('#dev-status-modal').modal('show');
        });

        $('#leaderboard-link').on('click', function (e) {
            e.preventDefault();
            $('#leaderboard-modal').modal('show');
        });

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                //apply entities merged stats saved during inactive tab
                self.applyInactiveTabEntityStream();
            }
            self.isActiveTab = !document.hidden;
        });

        if (typeof mode == 'string' && mode == 'play') {
            $('#igeFrontBuffer').click(function (e) {
                $('#more-games').removeClass('slideup-menu-animation').addClass('slidedown-menu-animation')
            })
        }

        // components required for client side game logic
        ige.addComponent(GameComponent);
        
        self.loadConfig();
        self.loadScenes();

        $.when(self.configLoaded, self.scenesLoaded).done(function () {
            self.loadGame();
        })
    },

    loadConfig: function () {
        var self = this;

        $.getJSON("./src/config.json", function(data) {
            ige.game.config = data;
            console.log("config.json loaded")
            self.configLoaded.resolve();
        });   
    },

    loadScenes: function () {
        var self = this;

        // when all textures have loaded
        ige.on('texturesLoaded', function () {
            // Ask the engine to start
            ige.start(function (success) {
                // Check if the engine started successfully
                if (success) {
                    self.rootScene = new IgeScene2d().id('rootScene').drawBounds(false);
                    self.tilesheetScene = new IgeScene2d().id('tilesheetScene').drawBounds(true).drawMouse(true);
                    self.mainScene = new IgeScene2d().id('baseScene').mount(self.rootScene).drawMouse(true);
                    self.objectScene = new IgeScene2d().id('objectScene').mount(self.mainScene)
                    ige.addComponent(RegionManager);

                    // Create the UI scene
                    self.uiScene = new IgeScene2d()
                        .id('uiScene')
                        .depth(1000)
                        .ignoreCamera(true)
                        .mount(self.rootScene);

                    self.vp1 = new IgeViewport()
                        .id('vp1')
                        .autoSize(true)
                        .scene(self.rootScene)
                        .drawBounds(false)
                        .mount(ige);

                    ige._selectedViewport = self.vp1;

                    console.log("all scenes loaded")

                    self.scenesLoaded.resolve();
                }
            });
        });
    },

    loadTextures: function () {
        var self = this;
        return new Promise(function (resolve, reject) {        
            var version = 1;
            var resource = ige.pixi.loader;

            // used when texture is not loaded in cache.
            resource.add("emptyTexture", "https://cache.modd.io/asset/spriteImage/1560747844626_dot.png?version=" + version, { crossOrigin: true });

            for (var key in ige.game.data.unitTypes) {
                var unit = ige.game.data.unitTypes[key];
                var cellSheet = unit.cellSheet;
                if (cellSheet && !ige.client.loadedTextures[cellSheet.url]) {
                    ige.client.loadedTextures[cellSheet.url] = cellSheet;
                    resource.add(cellSheet.url, cellSheet.url + "?version=" + version, { crossOrigin: true });
                }
            }
            for (var key in ige.game.data.projectileTypes) {
                var projectile = ige.game.data.projectileTypes[key];
                var cellSheet = projectile.cellSheet;
                if (cellSheet.url && !ige.client.loadedTextures[cellSheet.url]) {
                    ige.client.loadedTextures[cellSheet.url] = cellSheet;
                    resource.add(cellSheet.url, cellSheet.url + "?version=" + version, { crossOrigin: true });
                }
            }
            for (var key in ige.game.data.itemTypes) {
                var item = ige.game.data.itemTypes[key];
                var cellSheet = item.cellSheet;

                if (cellSheet && !ige.client.loadedTextures[cellSheet.url]) {
                    ige.client.loadedTextures[cellSheet.url] = cellSheet;
                    resource.add(cellSheet.url, cellSheet.url + "?version=" + version, { crossOrigin: true });
                }
            }

            resource.load(function (loadedResource) {
                for (var imageName in loadedResource.resources) {
                    var resource = loadedResource.resources[imageName];
                    resource.animation = new IgePixiAnimation();
                    if (resource && resource.url) {
                        var cellSheet = ige.client.loadedTextures[resource.name];
                        if (cellSheet) {
                            resource.animation.getAnimationSprites(resource.url, cellSheet.columnCount, cellSheet.rowCount);
                        }
                    }
                }
                ige.map.load(ige.game.data.map);
                self.texturesLoaded.resolve();
            });
        });
        // console.log('item textures loaded');
    },

    setZoom: function (zoom) {

        // on mobile increase default zoom by 25%
        if (ige.mobileControls.isMobile) {
            zoom *= 0.75; // visible area less 25%
        }

        ige.pixi.zoom(zoom);
        // prevent camera moving outside of map bounds
        // var buffer = 0;
        if (ige.client.resolutionQuality === 'low') {
            viewArea.width = viewArea.width * 0.5;
            viewArea.height = viewArea.height * 0.5;;
        }

    },

    loadGame: function () {
        var self = this;
        var gameJsonLoaded;
        
        ige.addComponent(IgeInitPixi);
        ige.addComponent(IgeNetIoComponent);
        ige.addComponent(SoundComponent);
        ige.addComponent(MapComponent);
        ige.addComponent(MenuUiComponent);
        ige.addComponent(TradeUiComponent);
        ige.addComponent(MobileControlsComponent);
        
        if (ige.game.config.minimapEnabled) {
            self.minimapScene = new IgeScene2d().id('minimapScene').drawBounds(false);
            ige.addComponent(MiniMapComponent)
            ige.addComponent(MiniMapUnit);
        }
        
        // decide on whether to load game from modd.io or from the local game.json file
        if (ige.game.config.gameId) {
            gameJsonLoaded = new Promise(function (resolve, reject) {

                $.when(self.scenesLoaded).done(function () {
                    $.ajax({
                        url: "https://beta.modd.io/api/game-client/" + ige.game.config.gameId,
                        dataType: "json",
                        type: 'GET',
                        success: function (game) {
                            ige.menuUi.getServerPing(true);
                            resolve(game);
                        }
                    })
                })
            })
        } else {
            gameJsonLoaded = new Promise(function (resolve, reject) {
                $.ajax({
                    url: '/src/game.json',
                    dataType: "json",
                    type: 'GET',
                    success: function (game) {
                        var data = { data: {} };
                        game.defaultData = game;
                        for (let [key, value] of Object.entries(game)) {
                            data['data'][key] = value;
                        }
                        for (let [key, value] of Object.entries(game.data)) {
                            data['data'][key] = value;
                        }
                        resolve(data);
                    }
                })
            })
        }


        gameJsonLoaded.then(function (game) {
            if (!game.data.isDeveloper) {
                game.data.isDeveloper = window.isStandalone;
            }
            ige.game.data = game.data;

            if (ige.game.data.isDeveloper) {
                $('#mod-this-game-menu-item').removeClass('d-none');
            }

            for (let i in ige.game.data.unitTypes) {
                let unit = ige.game.data.unitTypes[i];
                let image = new Image();
                image.src = unit.cellSheet.url;
                image.onload = function () {
                    ige.game.data.unitTypes[i].cellSheet.originalHeight = image.height / unit.cellSheet.rowCount;
                    ige.game.data.unitTypes[i].cellSheet.originalWidth = image.width / unit.cellSheet.columnCount;
                }
            }

            if (ige.game.data.defaultData.clientPhysicsEngine) {
                ige.addComponent(PhysicsComponent)
                    .physics.sleep(true);
            }

            ige.menuUi.clipImageForShop();
            ige.scaleMap(game.data.map);

            ige.client.loadTextures()
                
            if (ige.game.config.minimapEnabled) {
                $('#leaderboard').css({
                    top: '190px'
                })
                ige.miniMap.updateMiniMap();
            }

            var engineTickFrameRate = 15
            if (game.data.defaultData && !isNaN(game.data.defaultData.frameRate)) {
                engineTickFrameRate = Math.max(15, Math.min(parseInt(game.data.defaultData.frameRate), 60)) // keep fps range between 15 and 60
            }
            ige._physicsTickRate = engineTickFrameRate;

            ige.menuUi.toggleScoreBoard();
            ige.menuUi.toggleLeaderBoard();

            if (ige.game.data.isDeveloper) {
                // ige.addComponent(DevConsoleComponent);
            }

            // center camera while loading
            var tileWidth = ige.scaleMapDetails.tileWidth,
                tileHeight = ige.scaleMapDetails.tileHeight;

            ige.client.vp1.camera.translateTo((ige.map.data.width * tileWidth) / 2, (ige.map.data.height * tileHeight) / 2, 0);

            ige.addComponent(AdComponent); // ads should only be shown in games

            if (ige.physics) {
                self.loadCSP(); // always enable CSP.
            }
            ige.addComponent(VariableComponent);
        })

        $.when(self.mapLoaded, self.texturesLoaded).done(function () {

            var zoom = 1000
            if (ige.game.data.settings.camera && ige.game.data.settings.camera.zoom && ige.game.data.settings.camera.zoom.default) {
                zoom = ige.game.data.settings.camera.zoom.default
                self._trackTranslateSmoothing = ige.game.data.settings.camera.trackingDelay || 15;
            }

            self.setZoom(zoom);

            ige.addComponent(TimerComponent);
            ige.addComponent(ThemeComponent);
            ige.addComponent(PlayerUiComponent);
            ige.addComponent(UnitUiComponent);
            ige.addComponent(ItemUiComponent);
            ige.addComponent(ScoreboardComponent);
            ige.addComponent(ShopComponent); // game data is needed to populate shop
            if (ige.game.config.minimapEnabled) {
                ige.miniMap.createMiniMap();
            }
            // if (ige.game.data.settings.shop && ige.game.data.settings.shop.isEnabled) {
            ige.shop.enableShop();

            // ige.client.preLoadAnimationTextures();
            //load sound and music
            //when game starts
            ige.sound.preLoadSound();
            ige.sound.preLoadMusic();

            window.activatePlayGame = true;
            window.activatePlayGame = true;
            $('#play-game-button-wrapper').removeClass('d-none-important');
            $('.modal-videochat-backdrop, .modal-videochat').removeClass('d-none');
            $('.modal-videochat').show();
            $(".modal-step-link[data-step=2]").click();
        }); // map loaded
        
    },

    connectToServer: function () {

        let servers = ige.game.config.servers;
        let server = servers[0];
        if (SSL) {
            var protocol = 'wss://'
        } else {
            var protocol = 'ws://'
        }

        let url = protocol + server.ip + ":" + server.port;

        ige.network.start(url, function (data) {

            $('#loading-container').addClass('slider-out');

            console.log("connected to", server, "clientId", ige.network.id());
            ige.client.defineNetworkEvents();

            ige.network.send('igeChatJoinRoom', "1");

            ige.addComponent(IgeChatComponent);
            ige.addComponent(VideoChatComponent);
            ige.chat.on('messageFromServer', function (msgData) {
                ige.chat.postMessage(msgData);
            });

            var sendInterval = ige.game.data.settings.latency || (ige._fpsRate > 0) ? 1000 / ige._fpsRate : 70;

            // check for all of the existing entities in the game
            ige.network.addComponent(IgeStreamComponent)
            ige.network.stream.renderLatency(50) // Render the simulation renderLatency milliseconds in the past
            
            // ige.network.stream.sendInterval(sendInterval) // for some reason, this breaks game.js
            ige.network.stream._streamInterval = sendInterval;
            // Create a listener that will fire whenever an entity is created because of the incoming stream data
            ige.network.stream.on('entityCreated', function (entity) {
                if (entity._category == 'unit') // unit detected. add it to units array
                {
                    var unit = entity;
                    unit.equipSkin();
                    if (unit._stats.ownerId) {
                        var ownerPlayer = ige.$(unit._stats.ownerId);
                        if (ownerPlayer) {
                            unit.setOwnerPlayer(unit._stats.ownerId, { dontUpdateName: true });
                        }
                        
                        if (ownerPlayer == ige.client.myPlayer) {
                            unit.renderMobileControl();
                            ige.mobileControls.attach(self.uiScene);
                        }
                    }
                }
                else if (entity._category == 'player') {
                    // apply skin to all units that's owned by this player
                    var player = entity;
                    if (player._stats.controlledBy === 'human') {
                        // if the player is me
                        if (player._stats.clientId == ige.network.id()) {
                            ige.client.eventLog.push([ige._currentTime - ige.client.eventLogStartTime, 'my player created'])
                            ige.client.myPlayer = player; // declare my player
                            if (typeof startVideoChat == "function") {
                                startVideoChat(player.id())
                            }
                            player.redrawUnits(['nameLabel']);
                        }

                        // if there are pre-existing units that belongs to this newly detected player, assign those units' owner as this player
                        var unitsObject = ige.game.getUnitsByClientId(player._stats.clientId);
                        for (var unitId in unitsObject) {
                            unitsObject[unitId].setOwnerPlayer(player.id(), { dontUpdateName: true })
                        }

                        if (player._stats && player._stats.selectedUnitId) {
                            var unit = ige.$(player._stats.selectedUnitId);
                            if (unit) {
                                unit.equipSkin();
                            }
                        }
                    }
                }
            });

            ige.network.stream.on('entityDestroyed', function (entity) {
                if (entity._category == 'unit') {
                    entity.remove();
                }
            });

            ige.game.start();
            ige.menuUi.playGame();

            // $('#toggle-dev-panels').show();
        
        });
    },

    loadCSP: function () {
        ige.game.cspEnabled = !!ige.game.data.defaultData.clientSidePredictionEnabled;
        var gravity = ige.game.data.settings.gravity
        if (gravity) {
            console.log("setting gravity ", gravity)
            ige.physics.gravity(gravity.x, gravity.y)
        }
        ige.physics.createWorld();
        ige.physics.start();
        ige.addComponent(TriggerComponent);
        ige.addComponent(VariableComponent);
        ige.addComponent(ScriptComponent);
        ige.addComponent(ConditionComponent);
        ige.addComponent(ActionComponent);
        
    },

    defineNetworkEvents: function () {
        var self = this;

        ige.network.define('makePlayerSelectUnit', self._onMakePlayerSelectUnit);
        ige.network.define('makePlayerCameraTrackUnit', self._onMakePlayerCameraTrackUnit);
        ige.network.define('changePlayerCameraPanSpeed', self._onChangePlayerCameraPanSpeed);
        ige.network.define('hideUnitFromPlayer', self._onHideUnitFromPlayer);
        ige.network.define('showUnitFromPlayer', self._onShowUnitFromPlayer);
        ige.network.define('hideUnitNameLabelFromPlayer', self._onHideUnitNameLabelFromPlayer);
        ige.network.define('showUnitNameLabelFromPlayer', self._onShowUnitNameLabelFromPlayer);
        ige.network.define('updateAllEntities', self._onUpdateAllEntities);
        ige.network.define('teleport', self._onTeleport);
        ige.network.define('updateEntityAttribute', self._onUpdateEntityAttribute);
        ige.network.define('updateUiText', self._onUpdateUiText);
        ige.network.define('updateUiTextForTime', self._onUpdateUiTextForTime);
        ige.network.define('alertHighscore', self._onAlertHighscore);
        ige.network.define('item', self._onItem);
        ige.network.define('clientDisconnect', self._onClientDisconnect);
        ige.network.define('ui', self._onUi);
        ige.network.define('playAd', self._onPlayAd);
        ige.network.define('buySkin', self._onBuySkin);
        ige.network.define('videoChat', self._onVideoChat);
        ige.network.define('devLogs', self._onDevLogs);
        ige.network.define('errorLogs', self._onErrorLogs);
        ige.network.define('sound', self._onSound);
        ige.network.define('particle', self._onParticle);
        ige.network.define('camera', self._onCamera);
        ige.network.define('gameSuggestion', self._onGameSuggestion);
        ige.network.define('minimap', self._onMinimapEvent);
        ige.network.define('createFloatingText', self._onCreateFloatingText)
        ige.network.define('openShop', self._onOpenShop);
        ige.network.define('openDialogue', self._onOpenDialogue);
        ige.network.define('closeDialogue', self._onCloseDialogue);
        ige.network.define('setOwner', self._setOwner);
        ige.network.define('userJoinedGame', self._onUserJoinedGame);
        ige.network.define('trade', self._onTrade);
    },

    login: function () {
        var self = this;
        console.log("attempting to login")
        $.ajax({
            url: '/login',
            data: {
                username: $("input[name='username']").val(),
                password: $("input[name='password']").val()
            },
            dataType: "json",
            jsonpCallback: 'callback',
            type: 'POST',
            success: function (data) {
                if (data.response == 'success') {
                    self.joinGame()
                } else {
                    $("#login-error-message").html(data.message).show().fadeOut(7000)
                }
            }
        })
    },

    joinGame: function () {
        var self = this;
        var isAdBlockEnabled = true;
        var data = {
            number: (Math.floor(Math.random() * 999) + 100)
        }
        ige.client.removeOutsideEntities = undefined;
        window.joinedGame = true;

        $("#dev-console").hide()

        if (typeof (userId) !== 'undefined' && typeof (sessionId) !== 'undefined') {
            data._id = userId;
        }

        if (ige.mobileControls && !ige.mobileControls.isMobile) {
            $(".game-ui").show();
        }
        
        //show popover on setting icon for low frame rate
        if (!ige.mobileControls.isMobile) {
            setTimeout(function () {
                self.lowFPSInterval = setInterval(function () {
                    if (self.resolutionQuality !== 'low' && ige._renderFPS < 40) {
                        $('#setting').popover('show');
                        clearInterval(self.lowFPSInterval);
                    }
                }, 60000);
            }, 60000);
        }

        $(document).on("click", function () {
            $('#setting').popover('hide');
        })

        ige.network.send('joinGame', data);
        window.joinGameSent.start = Date.now();
        console.log("joinGame sent");

        // if game was paused
        if (!window.playerJoined) {
            ige.client.eventLog.push([0, "joinGame sent. userId " + userId])
            ige.client.eventLogStartTime = ige._currentTime;
        }
    },

    applyInactiveTabEntityStream: function () {
        var self = this;
        for (var entityId in self.inactiveTabEntityStream) {
            var entityData = _.cloneDeep(self.inactiveTabEntityStream[entityId]);
            self.inactiveTabEntityStream[entityId] = [];
            var entity = ige.$(entityId);
            if (entity && entityData) {
                // console.log("inactive Entity Update", entityData)
                entity.streamUpdateData(entityData);
            }
        }
    },

    positionCamera: function (x, y) {
        if (x !== undefined && y !== undefined) {
            ige.pixi.viewport.removePlugin('follow')
            console.log(ige.pixi.viewport)
            // using panTo for translating without animating
            // ige.client.vp1.camera.panTo({ x: x, y: y, z: 0 }, 0, 0);
            ige.pixi.viewport.moveCenter(x, y);
            // not working properly for some reason
            // var point = new IgePoint3d(x, y, 0);
            // this.vp1.camera.panTo(point, 1000);
        }
    }
});

if (typeof (module) !== 'undefined' && typeof (module.exports) !== 'undefined') {
    module.exports = Client;
}
