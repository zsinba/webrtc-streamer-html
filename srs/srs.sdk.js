
//
// Copyright (c) 2013-2021 Winlin
//
// SPDX-License-Identifier: MIT
//

'use strict';

// Depends on adapter-7.4.0.min.js from https://github.com/webrtc/adapter
// Async-awat-prmise based SRS RTC Publisher.
function SrsRtcPublisherAsync() {
    var self = {};

    // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
    self.constraints = {
        audio: true,
        video: {
            width: {ideal: 320, max: 576}
        }
    };

    // @see https://github.com/rtcdn/rtcdn-draft
    // @url The WebRTC url to play with, for example:
    //      webrtc://r.ossrs.net/live/livestream
    // or specifies the API port:
    //      webrtc://r.ossrs.net:11985/live/livestream
    // or autostart the publish:
    //      webrtc://r.ossrs.net/live/livestream?autostart=true
    // or change the app from live to myapp:
    //      webrtc://r.ossrs.net:11985/myapp/livestream
    // or change the stream from livestream to mystream:
    //      webrtc://r.ossrs.net:11985/live/mystream
    // or set the api server to myapi.domain.com:
    //      webrtc://myapi.domain.com/live/livestream
    // or set the candidate(eip) of answer:
    //      webrtc://r.ossrs.net/live/livestream?candidate=39.107.238.185
    // or force to access https API:
    //      webrtc://r.ossrs.net/live/livestream?schema=https
    // or use plaintext, without SRTP:
    //      webrtc://r.ossrs.net/live/livestream?encrypt=false
    // or any other information, will pass-by in the query:
    //      webrtc://r.ossrs.net/live/livestream?vhost=xxx
    //      webrtc://r.ossrs.net/live/livestream?token=xxx
    self.publish = async function (url) {
        var conf = self.__internal.prepareUrl(url);
        self.pc.addTransceiver("audio", {direction: "sendonly"});
        self.pc.addTransceiver("video", {direction: "sendonly"});

        if (!navigator.mediaDevices && window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
            throw new Error(`Please use HTTPS or localhost to publish, read https://github.com/ossrs/srs/issues/2762#issuecomment-983147576`);
        }
        var stream = await navigator.mediaDevices.getUserMedia(self.constraints);

        // @see https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addStream#Migrating_to_addTrack
        stream.getTracks().forEach(function (track) {
            self.pc.addTrack(track);

            // Notify about local track when stream is ok.
            self.ontrack && self.ontrack({track: track});
        });

        var offer = await self.pc.createOffer();
        await self.pc.setLocalDescription(offer);
        var session = await new Promise(function (resolve, reject) {
            // @see https://github.com/rtcdn/rtcdn-draft
            var data = {
                api: conf.apiUrl, tid: conf.tid, streamurl: conf.streamUrl,
                clientip: null, sdp: offer.sdp
            };
            console.log("Generated offer: ", data);

            $.ajax({
                type: "POST", url: conf.apiUrl, data: JSON.stringify(data),
                contentType: 'application/json', dataType: 'json'
            }).done(function (data) {
                console.log("Got answer: ", data);
                if (data.code) {
                    reject(data);
                    return;
                }

                resolve(data);
            }).fail(function (reason) {
                reject(reason);
            });
        });
        await self.pc.setRemoteDescription(
            new RTCSessionDescription({type: 'answer', sdp: session.sdp})
        );
        session.simulator = conf.schema + '//' + conf.urlObject.server + ':' + conf.port + '/rtc/v1/nack/';

        return session;
    };

    // Close the publisher.
    self.close = function () {
        self.pc && self.pc.close();
        self.pc = null;
    };

    // The callback when got local stream.
    // @see https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addStream#Migrating_to_addTrack
    self.ontrack = function (event) {
        // Add track to stream of SDK.
        self.stream.addTrack(event.track);
    };

    // Internal APIs.
    self.__internal = {
        defaultPath: '/rtc/v1/publish/',
        prepareUrl: function (webrtcUrl) {
            var urlObject = self.__internal.parse(webrtcUrl);

            // If user specifies the schema, use it as API schema.
            var schema = urlObject.user_query.schema;
            schema = schema ? schema + ':' : window.location.protocol;

            var port = urlObject.port || 1985;
            if (schema === 'https:') {
                port = urlObject.port || 443;
            }

            // @see https://github.com/rtcdn/rtcdn-draft
            var api = urlObject.user_query.play || self.__internal.defaultPath;
            if (api.lastIndexOf('/') !== api.length - 1) {
                api += '/';
            }

            apiUrl = schema + '//' + urlObject.server + ':' + port + api;
            for (var key in urlObject.user_query) {
                if (key !== 'api' && key !== 'play') {
                    apiUrl += '&' + key + '=' + urlObject.user_query[key];
                }
            }
            // Replace /rtc/v1/play/&k=v to /rtc/v1/play/?k=v
            var apiUrl = apiUrl.replace(api + '&', api + '?');

            var streamUrl = urlObject.url;

            return {
                apiUrl: apiUrl, streamUrl: streamUrl, schema: schema, urlObject: urlObject, port: port,
                tid: Number(parseInt(new Date().getTime()*Math.random()*100)).toString(16).substr(0, 7)
            };
        },
        parse: function (url) {
            // @see: http://stackoverflow.com/questions/10469575/how-to-use-location-object-to-parse-url-without-redirecting-the-page-in-javascri
            var a = document.createElement("a");
            a.href = url.replace("rtmp://", "http://")
                .replace("webrtc://", "http://")
                .replace("rtc://", "http://");

            var vhost = a.hostname;
            var app = a.pathname.substr(1, a.pathname.lastIndexOf("/") - 1);
            var stream = a.pathname.substr(a.pathname.lastIndexOf("/") + 1);

            // parse the vhost in the params of app, that srs supports.
            app = app.replace("...vhost...", "?vhost=");
            if (app.indexOf("?") >= 0) {
                var params = app.substr(app.indexOf("?"));
                app = app.substr(0, app.indexOf("?"));

                if (params.indexOf("vhost=") > 0) {
                    vhost = params.substr(params.indexOf("vhost=") + "vhost=".length);
                    if (vhost.indexOf("&") > 0) {
                        vhost = vhost.substr(0, vhost.indexOf("&"));
                    }
                }
            }

            // when vhost equals to server, and server is ip,
            // the vhost is __defaultVhost__
            if (a.hostname === vhost) {
                var re = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
                if (re.test(a.hostname)) {
                    vhost = "__defaultVhost__";
                }
            }

            // parse the schema
            var schema = "rtmp";
            if (url.indexOf("://") > 0) {
                schema = url.substr(0, url.indexOf("://"));
            }

            var port = a.port;
            if (!port) {
                if (schema === 'http') {
                    port = 80;
                } else if (schema === 'https') {
                    port = 443;
                } else if (schema === 'rtmp') {
                    port = 1935;
                }
            }

            var ret = {
                url: url,
                schema: schema,
                server: a.hostname, port: port,
                vhost: vhost, app: app, stream: stream
            };
            self.__internal.fill_query(a.search, ret);

            // For webrtc API, we use 443 if page is https, or schema specified it.
            if (!ret.port) {
                if (schema === 'webrtc' || schema === 'rtc') {
                    if (ret.user_query.schema === 'https') {
                        ret.port = 443;
                    } else if (window.location.href.indexOf('https://') === 0) {
                        ret.port = 443;
                    } else {
                        // For WebRTC, SRS use 1985 as default API port.
                        ret.port = 1985;
                    }
                }
            }

            return ret;
        },
        fill_query: function (query_string, obj) {
            // pure user query object.
            obj.user_query = {};

            if (query_string.length === 0) {
                return;
            }

            // split again for angularjs.
            if (query_string.indexOf("?") >= 0) {
                query_string = query_string.split("?")[1];
            }

            var queries = query_string.split("&");
            for (var i = 0; i < queries.length; i++) {
                var elem = queries[i];

                var query = elem.split("=");
                obj[query[0]] = query[1];
                obj.user_query[query[0]] = query[1];
            }

            // alias domain for vhost.
            if (obj.domain) {
                obj.vhost = obj.domain;
            }
        }
    };

    self.pc = new RTCPeerConnection(null);

    // To keep api consistent between player and publisher.
    // @see https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addStream#Migrating_to_addTrack
    // @see https://webrtc.org/getting-started/media-devices
    self.stream = new MediaStream();

    return self;
}

// Depends on adapter-7.4.0.min.js from https://github.com/webrtc/adapter
// Async-await-promise based SRS RTC Player.
function SrsRtcPlayerAsync() {
    var self = {};
    var _protocol = "http://";
    var _host = "stream.yuanjinapp.com";
    var _port = ":1985";
    var _prefix_url = _protocol + _host  + _port;
    var _apiUrl = _prefix_url + "/yuanjin/SND005" ;
    var _hangupUrl =  _prefix_url + "/rtc/v1/nack/?drop=1&username=";

    /**
     * http://stream.yuanjinapp.com:1985/yuanjin/SND005'
     * https://stream.yuanjinapp.com:1986/rtc/v1/nack/?drop=1&username=b3pn81j0:lNYm
     **/


    // @see https://github.com/rtcdn/rtcdn-draft
    // @url The WebRTC url to play with, for example:
    //      webrtc://r.ossrs.net/live/livestream
    // or specifies the API port:
    //      webrtc://r.ossrs.net:11985/live/livestream
    // or autostart the play:
    //      webrtc://r.ossrs.net/live/livestream?autostart=true
    // or change the app from live to myapp:
    //      webrtc://r.ossrs.net:11985/myapp/livestream
    // or change the stream from livestream to mystream:
    //      webrtc://r.ossrs.net:11985/live/mystream
    // or set the api server to myapi.domain.com:
    //      webrtc://myapi.domain.com/live/livestream
    // or set the candidate(eip) of answer:
    //      webrtc://r.ossrs.net/live/livestream?candidate=39.107.238.185
    // or force to access https API:
    //      webrtc://r.ossrs.net/live/livestream?schema=https
    // or use plaintext, without SRTP:
    //      webrtc://r.ossrs.net/live/livestream?encrypt=false
    // or any other information, will pass-by in the query:
    //      webrtc://r.ossrs.net/live/livestream?vhost=xxx
    //      webrtc://r.ossrs.net/live/livestream?token=xxx
    self.play = async function(url) {
        if(!url)
        {
            url = _apiUrl;
        }
        var conf = self.__internal.prepareUrl(url);
        self.pc.addTransceiver("audio", {direction: "recvonly"});
        self.pc.addTransceiver("video", {direction: "recvonly"});

        var offer = await self.pc.createOffer();
        await self.pc.setLocalDescription(offer);
        var session = await new Promise(function(resolve, reject) {
            // @see https://github.com/rtcdn/rtcdn-draft
            var data = {
                api: conf.apiUrl, tid: conf.tid, streamurl: conf.streamUrl,
                clientip: null, sdp: offer.sdp
            };
            console.log("Generated offer: ", data);
            localStorage['srsoffer'] = JSON.stringify(data)
            $.ajax({
                type: "POST", url: conf.apiUrl, data: JSON.stringify(data),
                contentType:'application/json', dataType: 'json'
            }).done(function(data) {
                console.log("Got answer: ", data);
                localStorage['srsanswer']  = JSON.stringify(data)
                if (data.code) {
                    reject(data); return;
                }

                resolve(data);
            }).fail(function(reason){
                reject(reason);
            });
        });
        await self.pc.setRemoteDescription(
            new RTCSessionDescription({type: 'answer', sdp: session.sdp})
        );
        session.simulator = conf.schema + '//' + conf.urlObject.server + ':' + conf.port + '/rtc/v1/nack/';

        return session;
    };

    self.hangup = function (){

        /**
         https://stream.yuanjinapp.com:1986/rtc/v1/nack/?drop=1&username=b3pn81j0:lNYm
         **/

        let  _json = JSON.parse(localStorage['srsanswer']);
        if (_json.sessionid  && _json.sessionid.length >5)
        {
            let _url = _hangupUrl + _json.sessionid;

            // close WebRTC session
            fetch(_url).then( (response) => {
            		console.log("hangup answer:" +response);
            	}).catch(error => {
            		this.onError("hangup error:" + error);
            	})
        }
        else
        {
            //Silence is golden
        }
    }

    self.getIceCandidate = function () {
        let ret =  [
            {
                "candidate": "candidate:0 1 udp 2130706431 47.101.192.64 8000 typ host generation 0",
                "sdpMLineIndex": 0  ,
                "sdpMid": "0"
            }
        ];
        console.log("getIceCandidate=" + JSON.stringify(ret))
        return ret;
    }

    //从sdp里获得ufrag
    self.ufrag = function (){
        let _srsanswer = JSON.parse(localStorage['srsanswer']);
        let _ufrag = _srsanswer.sdp.substring(_srsanswer.sdp.search('ufrag') + 6,_srsanswer.sdp.search('a=ice-pwd') - 2)
        console.log("ufrag=" + _ufrag);
        return _ufrag;
    }

    ///从sdp里获得密码
    self.pwd  = function (){
        let _srsanswer = JSON.parse(localStorage['srsanswer']);
        let tmpStr =  _srsanswer.sdp.substring(_srsanswer.sdp.search('ufrag') ,_srsanswer.sdp.search('ufrag') +100)
        console.log("tmpStr=" + tmpStr);
        let _ret = tmpStr.substring(tmpStr.search('ice-pwd:') + 8, tmpStr.search('a=finger'));
        console.log("pwd = " + _ret)
        return _ret;
    }

    self.seesionid = function (){
        let _srsanswer = JSON.parse(localStorage['srsanswer']);
        let sid = _srsanswer.sessionid;
        return  sid;
    }

    // Close the player.
    self.close = function() {
        self.pc && self.pc.close();
        self.pc = null;
    };

    // The callback when got remote track.
    // Note that the onaddstream is deprecated, @see https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/onaddstream
    self.ontrack = function (event) {
        // https://webrtc.org/getting-started/remote-streams
        self.stream.addTrack(event.track);
    };

    // Internal APIs.
    self.__internal = {
        defaultPath: '/rtc/v1/play/',
        prepareUrl: function (webrtcUrl) {
            var urlObject = self.__internal.parse(webrtcUrl);

            // If user specifies the schema, use it as API schema.
            var schema = urlObject.user_query.schema;
            schema = schema ? schema + ':' : window.location.protocol;

            var port = urlObject.port || 1985;
            if (schema === 'https:') {
                port = urlObject.port || 443;
            }

            // @see https://github.com/rtcdn/rtcdn-draft
            var api = urlObject.user_query.play || self.__internal.defaultPath;
            if (api.lastIndexOf('/') !== api.length - 1) {
                api += '/';
            }

            apiUrl = schema + '//' + urlObject.server + ':' + port + api;
            for (var key in urlObject.user_query) {
                if (key !== 'api' && key !== 'play') {
                    apiUrl += '&' + key + '=' + urlObject.user_query[key];
                }
            }
            // Replace /rtc/v1/play/&k=v to /rtc/v1/play/?k=v
            var apiUrl = apiUrl.replace(api + '&', api + '?');

            var streamUrl = urlObject.url;

            return {
                apiUrl: apiUrl, streamUrl: streamUrl, schema: schema, urlObject: urlObject, port: port,
                tid: Number(parseInt(new Date().getTime()*Math.random()*100)).toString(16).substr(0, 7)
            };
        },
        parse: function (url) {
            // @see: http://stackoverflow.com/questions/10469575/how-to-use-location-object-to-parse-url-without-redirecting-the-page-in-javascri
            var a = document.createElement("a");
            a.href = url.replace("rtmp://", "http://")
                .replace("webrtc://", "http://")
                .replace("rtc://", "http://");

            var vhost = a.hostname;
            var app = a.pathname.substr(1, a.pathname.lastIndexOf("/") - 1);
            var stream = a.pathname.substr(a.pathname.lastIndexOf("/") + 1);

            // parse the vhost in the params of app, that srs supports.
            app = app.replace("...vhost...", "?vhost=");
            if (app.indexOf("?") >= 0) {
                var params = app.substr(app.indexOf("?"));
                app = app.substr(0, app.indexOf("?"));

                if (params.indexOf("vhost=") > 0) {
                    vhost = params.substr(params.indexOf("vhost=") + "vhost=".length);
                    if (vhost.indexOf("&") > 0) {
                        vhost = vhost.substr(0, vhost.indexOf("&"));
                    }
                }
            }

            // when vhost equals to server, and server is ip,
            // the vhost is __defaultVhost__
            if (a.hostname === vhost) {
                var re = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
                if (re.test(a.hostname)) {
                    vhost = "__defaultVhost__";
                }
            }

            // parse the schema
            var schema = "rtmp";
            if (url.indexOf("://") > 0) {
                schema = url.substr(0, url.indexOf("://"));
            }

            var port = a.port;
            if (!port) {
                if (schema === 'http') {
                    port = 80;
                } else if (schema === 'https') {
                    port = 443;
                } else if (schema === 'rtmp') {
                    port = 1935;
                }
            }

            var ret = {
                url: url,
                schema: schema,
                server: a.hostname, port: port,
                vhost: vhost, app: app, stream: stream
            };
            self.__internal.fill_query(a.search, ret);

            // For webrtc API, we use 443 if page is https, or schema specified it.
            if (!ret.port) {
                if (schema === 'webrtc' || schema === 'rtc') {
                    if (ret.user_query.schema === 'https') {
                        ret.port = 443;
                    } else if (window.location.href.indexOf('https://') === 0) {
                        ret.port = 443;
                    } else {
                        // For WebRTC, SRS use 1985 as default API port.
                        ret.port = 1985;
                    }
                }
            }

            return ret;
        },
        fill_query: function (query_string, obj) {
            // pure user query object.
            obj.user_query = {};

            if (query_string.length === 0) {
                return;
            }

            // split again for angularjs.
            if (query_string.indexOf("?") >= 0) {
                query_string = query_string.split("?")[1];
            }

            var queries = query_string.split("&");
            for (var i = 0; i < queries.length; i++) {
                var elem = queries[i];

                var query = elem.split("=");
                obj[query[0]] = query[1];
                obj.user_query[query[0]] = query[1];
            }

            // alias domain for vhost.
            if (obj.domain) {
                obj.vhost = obj.domain;
            }
        }
    };

    self.pc = new RTCPeerConnection(null);

    // Create a stream to add track to the stream, @see https://webrtc.org/getting-started/remote-streams
    self.stream = new MediaStream();

    // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/ontrack
    self.pc.ontrack = function(event) {
        if (self.ontrack) {
            self.ontrack(event);
        }
    };

    return self;
}

// Format the codec of RTCRtpSender, kind(audio/video) is optional filter.
// https://developer.mozilla.org/en-US/docs/Web/Media/Formats/WebRTC_codecs#getting_the_supported_codecs
function SrsRtcFormatSenders(senders, kind) {
    var codecs = [];
    senders.forEach(function (sender) {
        var params = sender.getParameters();
        params && params.codecs && params.codecs.forEach(function(c) {
            if (kind && sender.track.kind !== kind) {
                return;
            }

            if (c.mimeType.indexOf('/red') > 0 || c.mimeType.indexOf('/rtx') > 0 || c.mimeType.indexOf('/fec') > 0) {
                return;
            }

            var s = '';

            s += c.mimeType.replace('audio/', '').replace('video/', '');
            s += ', ' + c.clockRate + 'HZ';
            if (sender.track.kind === "audio") {
                s += ', channels: ' + c.channels;
            }
            s += ', pt: ' + c.payloadType;

            codecs.push(s);
        });
    });
    return codecs.join(", ");
}
