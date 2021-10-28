/*
* Get the node module
* npm install websocket
*
* Increase the max duplicate ips 
* server.js this.maxDuplicateIpsAllowed = 999
*
* set botCount to somethign reasonable (40 will lag, but no longer freeze)
*
* optional: can re-enable the break; in IgeStreamComponent to reproduce the freezing
*/
var {WebSocket} = require('@clusterws/cws');;
var IP = process.env.IP || 'localhost';


function getRandomString() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < 5; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}


var botCount = 0
var maxBotCount = 32
function mockIgeConnection(i) {

    console.log(botCount, "<", maxBotCount)

    // closure exists to save i variable
    return function () {
        var name = 'bot_' + i
        var client = new WebSocket(`ws://${IP}/?token=`, 'netio1')

        client.on('connectFailed', error => {
            console.log('Connect Error: ' + error.toString())
        })


        client.on('open', connection => {

            console.log('WebSocket Client Connected')
            client.send(JSON.stringify(["@", "1"]));
            client.send(JSON.stringify(["\u0004", { "number": 494, "isAdBlockEnabled": false }]));
            client.send(JSON.stringify(["\n", [0, 0]]));


            client.on('error', error => {
                console.log("Connection Error: " + error.toString())
            })


            client.on('close', () => {
                console.log('echo-protocol Connection Closed')
            })


            client.on('message', message => {
                if (message.type === 'utf8') {
                    // uncomment to see data from server (reduce bot count to 1 first!)
                    //console.log(message.utf8Data)
                }
            })

            // after connecting, press "PLAY" button
            setTimeout(() => {
                client.send(JSON.stringify(['\u0004',
                    {
                        number: 200,
                        _id: undefined,
                        sessionId: getRandomString(),
                        isAdBlockEnabled: false
                    }])) //  player name change

            }, 200)

            var keys = ['w', 'a', 's', 'd']

            var commands = setInterval(() => {

                // release all keys
                for (var i = 0; i < keys.length; i++) {
                    client.send(JSON.stringify(['\t', { device: 'key', key: keys[i] }]));
                }

                // press one random key
                var randomInt = Math.floor(Math.random() * Math.floor(keys.length));
                client.send(JSON.stringify(['\b', { device: 'key', key: keys[randomInt] }]));

            }, 500)

            // disconnect player after 10000ms
            setTimeout(() => {
                clearInterval(commands)
                client.close()
                botCount--;
            }, 5000)
        })
    }
}

// create a new player every 250ms
setInterval(() => {
    while (botCount < maxBotCount) {
        mockIgeConnection(botCount)()
        botCount++
        break;
    }
}, 200)
