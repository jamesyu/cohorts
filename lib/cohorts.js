var dataLayer = dataLayer||[{}];

Cohorts = (function () {

    // Enable debugging through the console
    var Options = {
        debug: true
    };

    // By default, Cohorts events are pushed onto a data layer (if one is not defined in the test)
    var dataLayerAdapter = {

        nameSpace: 'experiments',
        onInitialize: function(inTest, testName, cohort, varSlot, scope) {
            var key = 'testSlot'+varSlot;
            var obj = {};
            obj[key] = testName+' '+cohort;
            dataLayer.push(obj);
            dataLayer.push({
                'event': 'experiment',
                'nameSpace': this.nameSpace,
                'testName': testName,
                'cohort': cohort,
                'testScope': scope
            });

        },
        onEvent: function(testName, cohort, eventName) {
            dataLayer.push({
                'event': 'event',
                'eventCategory': this.nameSpace,
                'eventAction': testName,
                'eventLabel': cohort,
                'eventProperty': scope,
                'eventValue': 1,
                'eventNonInt': false
            });

        }

    }
	
    // The main test object
    var Test = (function () {

        var cookiePrefix = '_cohorts';

        var constructor = function (options) {

            this.options = Utils.extend({
                name: null,
                cohorts: null,
                scope: 1,
                varSlot: null,
                sample: 1.0,
                storageAdapter: null
            }, options);

            // Check params
            if (this.options.name === null) throw ('A name for this test must be specified');
            if (this.options.cohorts === null) throw ('Cohorts must be specified for this test');
            if (Utils.size(options.cohorts) < 2) throw ('You must specify at least 2 cohorts for a test');
            if (!this.options.varSlot) this.options.varSlot = 5;
            if (!this.options.storageAdapter) this.options.storageAdapter = dataLayerAdapter;

            this.cohorts = Utils.keys(this.options.cohorts);

            this.run();

        };

        constructor.prototype = {

            run: function () {

                // Determine whether there is forcing of cohorts via the URL and set the cohort
                var hash = window.location.hash;
                var preview = false;
                if (hash.indexOf('#') == 0) hash = hash.slice(1, hash.length);
                var pairs = hash.split('&');
                for (var i = 0; i < pairs.length; i++) {
                    var pair = pairs[i].split('=');
                    var name = pair[0];
                    var cohort = pair[1];
                    if (this.options.name == name) {
                        Utils.log('Forcing test ' + name + ' into cohort ' + cohort);
                        this.setCohort(cohort);
                        preview = true;
                    }
                }

                // Determine whether user should be in the test & they're on a test page
                var in_test = this.inTest();
                var isExecutable = this.isExecutable();

                if (in_test === null && !isExecutable){
                    return;
                }
                if (in_test === null && isExecutable) {
                    in_test = Math.random() <= this.options.sample;
                }

                // Visitors selected into the test are assigned a cohort or set to view an existing one
                if (in_test || preview) {

                    Utils.log("Test Object ["+this.options.name+"] run.");
                    this.setCookie('in_test', 1);
                    var chosen_cohort;

                    if (!this.getCohort()) {

                        var partitions = 1.0 / Utils.size(this.options.cohorts);
                        var chosen_partition = Math.floor(Math.random() / partitions);
                        chosen_cohort = Utils.keys(this.options.cohorts)[chosen_partition];
                        this.setCohort(chosen_cohort);

                    } else {

                        // Returning visitors see the same cohort as last time
                        chosen_cohort = this.getCohort();

                    }

                    // Track visitors in the test
                    this.options.storageAdapter.onInitialize(in_test, this.options.name, chosen_cohort, this.options.varSlot, this.options.scope);

                    // If using redirectTo handler, redirect now to the URL (unless we're already there)
                    var chosenCohortObject = this.options.cohorts[chosen_cohort];
                    if (chosenCohortObject.redirectTo&&isExecutable)
                    {
                        var rd = chosenCohortObject.redirectTo;
                        if (Utils.isFunction(chosenCohortObject.redirectTo))
                        {
                            rd = rd();
                        }

                        if (rd&&rd.indexOf(window.location.href)<0)
                        {
                            window.location.href = rd;
                            return;
                        }
                    }

                    // Call the onChosen handler, if it exists and run the contents when we want them to run
                    // runNow: TRUE Immediately, else we'll execute onChosen when the DOM is ready
                    if (chosenCohortObject.onChosen&&isExecutable)
                    {
                        if (this.options.runNow)
                        {
                            Utils.log("Test Object ["+this.options.name+"] cohort onChosen ["+chosen_cohort+"] run.");
                            chosenCohortObject.onChosen();
                        }
                        else
                        {
                            var self = this;
                            Cohorts.domReady(function(){
                                Utils.log("Test Object ["+self.options.name+"] cohort onChosen ["+chosen_cohort+"] run.");
                                chosenCohortObject.onChosen();
                            });
                        }
                    }
                } else {

                    // For people who were excluded due to sampling, let's exclude them now
                    if (!this.isExecutable()) this.setCookie('in_test', 0);

                }

            },

            event: function (eventName) {
                if (this.inTest()) this.options.storageAdapter.onEvent(this.options.name, this.getCohort(), eventName);
            },

            /**
             * check if a test object is Executable(onChosen and redirect can be performed)
             * this method will check 4 options, urlMatch, uaBlock, cookieMatch, referrerMatch
             * all options must be matched.
             * @return {Boolean}
             */
            isExecutable:function()
            {

                var urlMatch = this.urlMatch();
                if (!urlMatch)
                {
                    Utils.log("Test Object ["+this.options.name+"] url not matched.");
                    return false;
                }

                var uaBlock = userAgentUtil.match(this.options.uaBlock);
                if (!uaBlock)
                {
                    Utils.log("Test Object ["+this.options.name+"] user agent blocked.");
                    return false;
                }

                var cookieMatch = this.cookieMatch();
                if (!cookieMatch)
                {
                    Utils.log("Test Object ["+this.options.name+"] cookie not matched.");
                    return false;
                }

                var referrerMatch = this.referrerMatch();
                if (!referrerMatch)
                {
                    Utils.log("Test Object ["+this.options.name+"] referrer not matched.");
                    return false;
                }

                return true;
            },
            /**
             * check if current page url matched the test object urlMatch option(url split feature)
             * urlMatch is an array of url items
             * you can specify it like this:
             * urlMatch: [/test1.html/i, /test2.html/i], that means, the test object will run in test1.html or test2.html
             * or urlMatch:[
             * {
             * regex: /gclid=/i,
             * regexType:1 (0--regex will apply for document.location.href, 1--regex will apply for document.location.pathname)
             * }
             * ],that means the regex will apply for document.location.search
             * @return {Boolean}
             */
            urlMatch: function()
            {
                var urlRegexes = this.options.urlMatch;
                var urlMatch = false;

                if (!urlRegexes) return true;
                if (urlRegexes.length <=0) return true;

                for (var i= 0,c=urlRegexes.length;i<c;i++)
                {
                    var regObj = urlRegexes[i], reg, regType = 0;

                    if (Utils.isObject(regObj)&&!regObj.test)
                    {
                        reg = regObj.regex;
                        regType = regObj.regexType == null?0:regObj.regexType;
                    }
                    else
                    {
                        reg = regObj;
                    }

                    if (regType == 0)
                    {
                        urlMatch = reg.test(document.location.href);
                    }
                    else
                    {
                        urlMatch = reg.test(document.location.pathname);
                    }

                    if (urlMatch) break;
                }

                return urlMatch;
            },
            /**
             * Check if the current page cookie values match the test object's cookieMatch option
             * cookieMatch is an array of cookie items, which you can specify like:
             * cookieMatch: [{c1: "c1value"}, {c2: "c2value"}]
             * That means, the test object will run when current cookies.c1="c1value" or cookies.c2="c2value"
             * For AND and OR matching try cookieMatch: [{c1: "c1value", c2: "c2value"}, {c3: "c3value"}]
             * The test object will run when current either value return true: (cookies.c1="c1value" and cookies.c2="c2value") or cookies.c3="c3value"
             * or you can specify cookieMatch as a function, in this case a cookie object contains all cookie values will pass to this function
             * you can make some complex statements in this function, then return TRUE means cookies were matched, FALSE means they weren't. e.g.
             * cookieMatch: function(cookies)
             * {
             *      return cookies.c1 == "c1value";
             * }
             * @return {Boolean}
             */
            cookieMatch: function()
            {
                var tc = this.options.cookieMatch;
                if (!tc) return true;

                var cookies = Cookies.parseCookies();

                if (Utils.isFunction(tc))
                {
                    return tc(cookies);
                }

                if (tc.length <=0) return true;

                var cookieMatch = false;

                for (var i= 0,c=tc.length;i<c;i++)
                {
                    var tco = tc[i];

                    var matchedCnt = 0, propertyCnt = 0;
                    for (var p in tco)
                    {
                        propertyCnt++;
                        if (cookies[p] == null) break;
                        if (cookies[p] != tco[p]) break;

                        matchedCnt++;
                    }

                    if (matchedCnt == propertyCnt)
                    {
                        cookieMatch = true;
                        break;
                    }
                }

                return cookieMatch;
            },
            /**
             * Check if the current page referrer value matches the test object referrerMatch option
             * referrerMatch can be an array of referrer values or a function, you can specify it like this:
             * referrerMatch: ["http://www.google.com", "http://www.facebook.com"], that means the test object will run when
             * document.referrer == "http://www.google.com" or "http://www.facebook.com"
             * or referrerMatch: function(referrer)
             * {
             *    return referrer == "http://www.twitter.com";
             * }
             * @return {Boolean}
             */
            referrerMatch: function()
            {
                var tr = this.options.referrerMatch;
                if (!tr) return true;

                if (Utils.isFunction(tr))
                {
                    return tr(document.referrer);
                }

                var referrer = document.referrer, referrerMatch = false;

                for (var i= 0,c=tr.length;i<c;i++)
                {
                    if (referrer == tr[i])
                    {
                        referrerMatch = true;
                        break;
                    }
                }

                return referrerMatch;
            },
            inTest: function () {
                if (this.getCookie('in_test') == 1) {
                    return true;
                } else if (this.getCookie('in_test') == 0) {
                    return false;
                } else {
                    return null;
                }
            },
            inCohort: function (cohort) {
                if (this.inTest()) {
                    return this.getCohort() == cohort;
                } else {
                    return false;
                }
            },
            getCohort: function () {
                if (this.inTest()) {
                    return this.getCookie('chosen_cohort');
                } else {
                    return null;
                }
            },
            setCohort: function (cohort) {
                if (Utils.arrayIndexOf(this.cohorts, cohort) == -1) {
                    return false;
                } else {
                    this.setCookie('chosen_cohort', cohort);
                    return true;
                }
            },
            setCookie: function (name, value, options) {
                Cookies.set(cookiePrefix + '_' + this.options.name + '_' + name, value, options, this.options.scope);
            },
            getCookie: function (name) {
                return Cookies.get(cookiePrefix + '_' + this.options.name + '_' + name);
            }
        };

        return constructor;
    })();

    var Utils = {
        extend: function (destination, source) {
            for (var property in source)
            destination[property] = source[property];
            return destination;
        },
        size: function (object) {
            var i = 0;
            for (var property in object)
            i += 1;
            return i;
        },
        keys: function (object) {
            var results = [];
            for (var property in object)
            results.push(property);
            return results;
        },
        log: function (message) {
            if (window['console'] && Options.debug) {
                if (console.log) {
                    console.log(message);
                } else {
                    alert(message);
                }
            }
        },
        isObject: function(it){
			return it !== undefined &&
				(it === null || typeof it == "object" );
		},
        isFunction: function(it){
            var opts = Object.prototype.toString;
			return opts.call(it) === "[object Function]";
		},
        arrayIndexOf: function(array, item)
        {
            if (Array.prototype.indexOf)
            {
                return array.indexOf(item);
            }
            else
            {
                var idx = -1;

                for (var i= 0, c=array.length;i<c;i++)
                {
                    if (array[i] == item)
                    {
                        idx = i;
                        break;
                    }
                }

                return idx;
            }
        }
    };

    // Adapted from James Auldridge's jquery.cookies
    var Cookies = (function () {

        var resolveOptions, assembleOptionsString, parseCookies, constructor, defaultOptions = {
            expiresAt: null,
            path: '/',
            domain: null,
            secure: false
        };

        /**
         * resolveOptions - receive an options object and ensure all options are present and valid, replacing with defaults where necessary
         *
         * @access private
         * @static
         * @parameter Object options - optional options to start with
         * @return Object complete and valid options object
         */
        resolveOptions = function (options) {
            var returnValue, expireDate;

            if (typeof options !== 'object' || options === null) {
                returnValue = defaultOptions;
            } else {
                returnValue = {
                    expiresAt: defaultOptions.expiresAt,
                    path: defaultOptions.path,
                    domain: defaultOptions.domain,
                    secure: defaultOptions.secure
                };

                if (typeof options.expiresAt === 'object' && options.expiresAt instanceof Date) {
                    returnValue.expiresAt = options.expiresAt;
                }

                if (typeof options.path === 'string' && options.path !== '') {
                    returnValue.path = options.path;
                }

                if (typeof options.domain === 'string' && options.domain !== '') {
                    returnValue.domain = options.domain;
                }

                if (options.secure === true) {
                    returnValue.secure = options.secure;
                }
            }

            return returnValue;
        };
        /**
         * assembleOptionsString - analyze options and assemble appropriate string for setting a cookie with those options
         *
         * @access private
         * @static
         * @parameter options OBJECT - optional options to start with
         * @return STRING - complete and valid cookie setting options
         */
        assembleOptionsString = function (options) {
            return (
                '; expires=' + ((options.expiresAt === null) ? 0 : options.expiresAt.toGMTString()) + '; path=' + options.path + (typeof options.domain === 'string' ? '; domain=' + options.domain : '') + (options.secure === true ? '; secure' : ''));
        };
        /**
         * parseCookies - retrieve document.cookie string and break it into a hash with values decoded and unserialized
         *
         * @access private
         * @static
         * @return OBJECT - hash of cookies from document.cookie
         */
        parseCookies = function () {
            var cookies = {}, i, pair, name, value, separated = document.cookie.split(';'),
                unparsedValue;
            for (i = 0; i < separated.length; i = i + 1) {
                pair = separated[i].split('=');
                name = pair[0].replace(/^\s*/, '').replace(/\s*$/, '');

                try {
                    value = decodeURIComponent(pair[1]);
                } catch (e1) {
                    value = pair[1];
                }

                if (typeof JSON === 'object' && JSON !== null && typeof JSON.parse === 'function') {
                    try {
                        unparsedValue = value;
                        value = JSON.parse(value);
                    } catch (e2) {
                        value = unparsedValue;
                    }
                }

                cookies[name] = value;
            }
            return cookies;
        };

        constructor = function () {};

        constructor.prototype.parseCookies = parseCookies;

        /**
         * get - get one, several, or all cookies
         *
         * @access public
         * @paramater Mixed cookieName - String:name of single cookie; Array:list of multiple cookie names; Void (no param):if you want all cookies
         * @return Mixed - Value of cookie as set; Null:if only one cookie is requested and is not found; Object:hash of multiple or all cookies (if multiple or all requested);
         */
        constructor.prototype.get = function (cookieName) {
            var returnValue, item, cookies = parseCookies();

            if (typeof cookieName === 'string') {
                returnValue = (typeof cookies[cookieName] !== 'undefined') ? cookies[cookieName] : null;
            } else if (typeof cookieName === 'object' && cookieName !== null) {
                returnValue = {};
                for (item in cookieName) {
                    if (typeof cookies[cookieName[item]] !== 'undefined') {
                        returnValue[cookieName[item]] = cookies[cookieName[item]];
                    } else {
                        returnValue[cookieName[item]] = null;
                    }
                }
            } else {
                returnValue = cookies;
            }

            return returnValue;
        };

        /**
         * set - set or delete a cookie with desired options
         *
         * @access public
         * @paramater String cookieName - name of cookie to set
         * @paramater Mixed value - Any JS value. If not a string, will be JSON encoded; NULL to delete
         * @paramater Object options - optional list of cookie options to specify
         * @return void
         */
        constructor.prototype.set = function (cookieName, value, options, scope) {
            if (typeof options !== 'object' || options === null) {
                var expire = new Date();

                options = {
                    expiresAt: new Date(expire),
                    path: '/',
                    domain: null,
                    secure: false
                };

                // Expire cookies after 2yrs with visitor level scope
                if (scope === 1) {
                    expire = expire.setTime(expire.getTime() + 3600000 * 24 * 730);
                    options.expiresAt = new Date(expire);
                }

                // Set cookie to expire at session level for session scope
                if (scope === 2) {
                    options.expiresAt = null;
                }

            }

            if (typeof value === 'undefined' || value === null) {
                value = '';
                options.hoursToLive = -8760;
            }
            else if (typeof value !== 'string') {
                if (typeof JSON === 'object' && JSON !== null && typeof JSON.stringify === 'function') {
                    value = JSON.stringify(value);
                } else {
                    value = value.toString();
                    // just set value = value.toString() in this case
                    //throw new Error('cookies.set() received non-string value and could not serialize.');
                }
            }

            var optionsString = assembleOptionsString(options);

            document.cookie = cookieName + '=' + encodeURIComponent(value) + optionsString;
        };

        return new constructor();
    })();

    // adapted from https://github.com/requirejs/domReady
    var domReadyUtil = (function(){

        var readyCalls = [], isPageLoaded = false ,scrollIntervalId,
            testDiv, isTop;

        // call domReady event callbacks one by one
        function callReady()
        {
            var callbacks = readyCalls;

            if (isPageLoaded)
            {
                if (callbacks.length)
                {
                    var i;
                    for (i = 0; i < readyCalls.length; i += 1)
                    {
                        readyCalls[i]();
                    }
                    readyCalls = [];
                }
            }
        }
        // noticed when page is loaded
        function pageLoaded(source)
        {

            if (!isPageLoaded)
            {
                isPageLoaded = true;
                if (scrollIntervalId)
                {
                    clearInterval(scrollIntervalId);
                }

                callReady();
            }
        }

        if (document.addEventListener) {
            document.addEventListener("DOMContentLoaded", pageLoaded, false);
            window.addEventListener("load", pageLoaded, false);
        } else if (window.attachEvent) {
            document.attachEvent( "onreadystatechange", function(){
                if (document.readyState == "interactive" || document.readyState == "complete" || document.readyState == "loaded")
                {
                    pageLoaded('readaySate');
                }
            } );

            window.attachEvent("onload", pageLoaded);

            testDiv = document.documentElement;
            try {
                isTop = window.frameElement === null;
            } catch (e) {}

            if (testDiv.doScroll && isTop && window.external) {
                scrollIntervalId = setInterval(function () {
                    try {
                        testDiv.doScroll();
                        pageLoaded("ie hack");
                    } catch (e) {}
                }, 2);
            }
        }

        if (document.readyState === "complete") {
            pageLoaded();
        }

        function domReady(callback)
        {
            if (isPageLoaded)
            {
                callback();
            }
            else
            {
                readyCalls.push(callback);
            }
            return domReady;
        }

        return domReady;
    })();
    // user agent util, inspired by dojo.sniff
    var userAgentUtil = {
        /**
         * detect user agent attributes
         */
        init: function()
        {
            var n = navigator,
                dua = n.userAgent,
                dav = n.appVersion,tv = parseFloat(dav);

            this.webkit = parseFloat(dua.split("WebKit/")[1]) || undefined;
            this.khtml = dav.indexOf("Konqueror") >= 0 ? tv : undefined;
            this.mac = dav.indexOf("Macintosh") >= 0;
            this.ios = /iPhone|iPod|iPad/.test(dua);
            this.android = parseFloat(dua.split("Android ")[1]) || undefined;
            this.bb = (dua.indexOf("BlackBerry") >= 0 || dua.indexOf("BB10") >=0)?parseFloat(dua.split("Version/")[1]) || undefined:undefined;

            this.chrome = parseFloat(dua.split("Chrome/")[1]) || undefined;
            this.safari = dav.indexOf("Safari")>=0 && !this.chrome ? parseFloat(dav.split("Version/")[1]) : undefined;

            if (this.chrome) this.chrome = Math.floor(this.chrome);
            if (this.safari) this.safari = Math.floor(this.safari);
            if (this.bb) this.bb = Math.floor(this.bb);

            if (!this.webkit)
            {
                if (dua.indexOf("Opera") >= 0)
                {
                    this.opera = tv >= 9.8 ? parseFloat(dua.split("Version/")[1]) || tv : tv;
                    this.opera = Math.floor(this.opera);
                }

                if (dua.indexOf("Gecko") >= 0 && !this.khtml && !this.webkit)
                {
                    this.mozilla = tv;
                }
                if (this.mozilla)
                {
                    this.ff = parseFloat(dua.split("Firefox/")[1] || dua.split("Minefield/")[1]) || undefined;

                    if (this.ff) this.ff = Math.floor(this.ff);
                }

                if (document.all && !this.opera)
                {
                    var isIE = parseFloat(dav.split("MSIE ")[1]) || undefined;

                    var mode = document.documentMode;
                    if (mode && mode != 5 && Math.floor(isIE) != mode)
                    {
                        isIE = mode;
                    }

                    this.ie = isIE;
                }
            }

            if (dua.match(/(iPhone|iPod|iPad)/))
            {
                var p = RegExp.$1.replace(/P/, 'p');
                var v = ua.match(/OS ([\d_]+)/) ? RegExp.$1 : "1";
                var os = parseFloat(v.replace(/_/, '.').replace(/_/g, ''));
                this[p] = os;
            }
        },
        /**
         * test if current browser's user agent matched the test object uaBlock options
         * @param tua test object uaBlock option, it's an array of ua items,
         * you can specify it like this:
         * uaBlock:["ie", "chrome"], that means test object will run on ie and chrome
         * uaBlock:[{ie:[9, 10]}, {chrome:[25, 26]}] that means test object will run on ie9, ie10, chrome25, chrome26
         * support ua names, ie, ff, chrome, safari, opera
         * we can also specify it by platforms like ios, android
         * support platform names, ios, android, bb
         * @return {Boolean}, true -- matched, false -- not matched.
         */
        match: function(tua)
        {
            if (!tua) return true;
            if (tua.length <=0) return true;

            var ret = false;

            for (var i= 0,c=tua.length;i<c;i++)
            {
                var tuaObject = tua[i];

                if (Utils.isObject(tuaObject))
                {
                    for (var p in tuaObject)
                    {
                        if (!this[p]) continue;

                        var items = tuaObject[p];
                        for (var m= 0,mc=items.length;m<mc;m++)
                        {
                            if (this[p] == items[m])
                            {
                                ret = true;
                                break;
                            }
                        }

                        if (ret) break;
                    }
                }
                else
                {
                    ret = this[tuaObject];
                }

                if (ret) break;
            }

            return ret;
        }
    };

    userAgentUtil.init();

    return {
        Test: Test,
        Cookies: Cookies,
        Options: Options,
        domReady: domReadyUtil,
        userAgent: userAgentUtil
    };
})();
