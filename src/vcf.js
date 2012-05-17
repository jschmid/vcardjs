/**
 ** VCF - Parser for the vcard format.
 **
 ** This is purely a vCard 4.0 implementation, as described in RFC 6350.
 **
 ** The generated VCard object roughly corresponds to the JSON representation
 ** of a hCard, as described here: http://microformats.org/wiki/jcard
 ** (Retrieved May 17, 2012)
 **
 **/

var VCF;

(function() {
    VCF = {

        simpleKeys: [
            'VERSION',
            'FN', // 6.2.1
            'PHOTO' // 6.2.4 (we don't care about URIs [yet])
        ],
        csvKeys: [
            'NICKNAME' // 6.2.3
        ],
        dateAndOrTimeKeys: [
            'BDAY',        // 6.2.5
            'ANNIVERSARY', // 6.2.6
        ],

        // parses the given input, constructing VCard objects.
        // if the input contains multiple (properly seperated) vcards,
        // the callback may be called multiple times, with one vcard given
        // each time.
        // The third argument specifies the context in which to evaluate
        // the given callback.
        parse: function(input, callback, context) {
            var vcard = null;

            if(! context) {
                context = this;
            }

            this.lex(input, function(key, value, attrs) {
                function setAttr(val) {
                    if(vcard) {
                        vcard.setAttribute(key.toLowerCase(), val);
                    }
                }
                if(key == 'BEGIN') {
                    vcard = new VCard();
                } else if(key == 'END') {
                    if(vcard) {
                        callback.apply(context, [vcard]);
                        vcard = null;
                    }

                } else if(this.simpleKeys.indexOf(key) != -1) {
                    setAttr(value);

                } else if(this.csvKeys.indexOf(key) != -1) {
                    setAttr(value.split(','));

                } else if(this.dateAndOrTimeKeys.indexOf(key) != -1) {
                    if(attrs.VALUE == 'text') {
                        // times can be expressed as "text" as well,
                        // e.g. "ca 1800", "next week", ...
                        setAttr(value);
                    } else if(attrs.CALSCALE && attrs.CALSCALE != 'gregorian') {
                        // gregorian calendar is the only calscale mentioned
                        // in RFC 6350. I do not intend to support anything else
                        // (yet).
                    } else {
                        // FIXME: handle TZ attribute.
                        setAttr(this.parseDateAndOrTime(value));
                    }

                } else if(key == 'N') {
                    setAttr(this.parseName(value));

                } else if(key == 'GENDER') {
                    setAttr(this.parseGender(value));

                } else {
                    console.log('WARNING: unhandled key: ', key);
                }
            });
        },
        
        nameParts: [
            'family-name', 'given-name', 'additional-name',
            'honorific-prefix', 'honorific-suffix'
        ],

        parseName: function(name) { // 6.2.2
            var parts = name.split(';');
            var n = {};
            for(var i in parts) {
                n[this.nameParts[i]] = parts[i].split(',');
            }
            return n;
        },

        /**
         * The representation of gender for hCards (and hence their JSON
         * representation) is undefined, as hCard is based on RFC 2436, which
         * doesn't define the GENDER attribute.
         * This method uses a compound representation.
         *
         * Examples:
         *   "GENDER:M"              -> {"sex":"male"}
         *   "GENDER:M;man"          -> {"sex":"male","identity":"man"}
         *   "GENDER:F;girl"         -> {"sex":"female","identity":"girl"}
         *   "GENDER:M;girl"         -> {"sex":"male","identity":"girl"}
         *   "GENDER:F;boy"          -> {"sex":"female","identity":"boy"}
         *   "GENDER:N;woman"        -> {"identity":"woman"}
         *   "GENDER:O;potted plant" -> {"sex":"other","identity":"potted plant"}
         */
        parseGender: function(value) { // 6.2.7
            var gender = {};
            var parts = value.split(';');
            switch(parts[0]) {
            case 'M':
                gender.sex = 'male';
                break;
            case 'F':
                gender.sex = 'female';
                break;
            case 'O':
                gender.sex = 'other';
            }
            if(parts[1]) {
                gender.identity = parts[1];
            }
            return gender;
        },

        /** Date/Time parser.
         * 
         * This implements only the parts of ISO 8601, that are
         * allowed by RFC 6350.
         * Paranthesized examples all represent (parts of):
         *   31st of January 1970, 23 Hours, 59 Minutes, 30 Seconds
         **/

        /** DATE **/

        // [ISO.8601.2004], 4.1.2.2, basic format:
        dateRE: /^(\d{4})(\d{2})(\d{2})$/, // (19700131)

        // [ISO.8601.2004], 4.1.2.3 a), basic format:
        dateReducedARE: /^(\d{4})\-(\d{2})$/, // (1970-01)

        // [ISO.8601.2004], 4.1.2.3 b), basic format:
        dateReducedBRE: /^(\d{4})$/, // (1970)

        // truncated representation from [ISO.8601.2000], 5.3.1.4.
        // I don't have access to that document, so relying on examples
        // from RFC 6350:
        dateTruncatedMDRE: /^\-{2}(\d{2})(\d{2})$/, // (--0131)
        dateTruncatedDRE: /^\-{3}(\d{2})$/, // (---31)

        /** TIME **/

        // (Note: it is unclear to me which of these are supposed to support
        //        timezones. Allowing them for all. If timezones are ommitted,
        //        defaulting to UTC)

        // [ISO.8601.2004, 4.2.2.2, basic format:
        timeRE: /^(\d{2})(\d{2})(\d{2})([+\-]\d+|Z|)$/, // (235930)
        // [ISO.8601.2004, 4.2.2.3 a), basic format:
        timeReducedARE: /^(\d{2})(\d{2})([+\-]\d+|Z|)$/, // (2359)
        // [ISO.8601.2004, 4.2.2.3 b), basic format:
        timeReducedBRE: /^(\d{2})([+\-]\d+|Z|)$/, // (23)
        // truncated representation from [ISO.8601.2000], see above.
        timeTruncatedMSRE: /^\-{2}(\d{2})(\d{2})([+\-]\d+|Z|)$/, // (--5930)
        timeTruncatedSRE: /^\-{3}(\d{2})([+\-]\d+|Z|)$/, // (---30)

        parseDate: function(data) {
            var md;
            var y, m, d;
            if((md = data.match(this.dateRE))) {
                y = md[1]; m = md[2]; d = md[3];
            } else if((md = data.match(this.dateReducedARE))) {
                y = md[1]; m = md[2];
            } else if((md = data.match(this.dateReducedBRE))) {
                y = md[1];
            } else if((md = data.match(this.dateTruncatedMDRE))) {
                m = md[1]; d = md[2];
            } else if((md = data.match(this.dateTruncatedDRE))) {
                d = md[1];
            } else {
                console.error("WARNING: failed to parse date: ", data);
                return null;
            }
            var dt = new Date(0);
            if(typeof(y) != 'undefined') { dt.setUTCFullYear(y); }
            if(typeof(m) != 'undefined') { dt.setUTCMonth(m - 1); }
            if(typeof(d) != 'undefined') { dt.setUTCDate(d); }
            return dt;
        },

        parseTime: function(data) {
            var md;
            var h, m, s, tz;
            if((md = data.match(this.timeRE))) {
                h = md[1]; m = md[2]; s = md[3];
                tz = md[4];
            } else if((md = data.match(this.timeReducedARE))) {
                h = md[1]; m = md[2];
                tz = md[3];
            } else if((md = data.match(this.timeReducedBRE))) {
                h = md[1];
                tz = md[2];
            } else if((md = data.match(this.timeTruncatedMSRE))) {
                m = md[1]; s = md[2];
                tz = md[3];
            } else if((md = data.match(this.timeTruncatedSRE))) {
                s = md[1];
                tz = md[2];
            } else {
                console.error("WARNING: failed to parse time: ", data);
                return null;
            }

            var dt = new Date(0);
            if(typeof(h) != 'undefined') { dt.setUTCHours(h); }
            if(typeof(m) != 'undefined') { dt.setUTCMinutes(m); }           
            if(typeof(s) != 'undefined') { dt.setUTCSeconds(s); }

            if(tz) {
                dt = this.applyTimezone(dt, tz);
            }

            return dt;
        },

        // add two dates. if addSub is false, substract instead of add.
        addDates: function(aDate, bDate, addSub) {
            if(typeof(addSub) == 'undefined') { addSub = true };
            if(! aDate) { return bDate; }
            if(! bDate) { return aDate; }
            var a = Number(aDate);
            var b = Number(bDate);
            var c = addSub ? a + b : a - b;
            return new Date(c);
        },

        applyTimezone: function(date, tz) {
            var md;
            if((md = tz.match(/^([+\-])(\d{2})(\d{2})?/))) {
                var offset = new Date(0);
                offset.setUTCHours(md[2]);
                offset.setUTCMinutes(md[3] || 0);
                return this.addDates(date, offset, md[1] == '+');
            } else {
                return date;
            }
        },

        parseDateTime: function(data) {
            var parts = data.split('T');
            var t = this.parseDate(parts[0]);
            var d = this.parseTime(parts[1]);
            return this.addDates(t, d);
        },

        parseDateAndOrTime: function(data) {
            switch(data.indexOf('T')) {
            case 0:
                return this.parseTime(data.slice(1));
            case -1:
                return this.parseDate(data);
            default:
                return this.parseDateTime(data);
            }
        },

        lineRE: /^([^\s].*)(?:\r?\n|$)/, // spec wants CRLF, but we're on the internet. reality is chaos.
        foldedLineRE:/^\s(.+)(?:\r?\n|$)/,

        // lex the given input, calling the callback for each line, with
        // the following arguments:
        //   * key - key of the statement, such as 'BEGIN', 'FN', 'N', ...
        //   * value - value of the statement, i.e. everything after the first ':'
        //   * attrs - object containing attributes, such as {"TYPE":"work"}
        lex: function(input, callback) {

            var md, line = null, length = 0;

            for(;;) {
                if((md = input.match(this.lineRE))) {
                    if(line) {
                        this.lexLine(line, callback);
                    }
                    line = md[1];
                    length = md[0].length;
                } else if((md = input.match(this.foldedLineRE))) {
                    if(line) {
                        line += md[1];
                        length = md[0].length;
                    } else {
                        // ignore folded junk.
                    }
                } else {
                    console.error("Unmatched line: " + line);
                }

                input = input.slice(length);

                if(! input) {
                    break;
                }
            }

            if(line) {
                // last line.
                this.lexLine(line, callback);
            }

            line = null;
        },

        lexLine: function(line, callback) {
            var tmp = '';
            var key = null, attrs = {}, value = null, attrKey = null;

            function finalizeKeyOrAttr() {
                if(key) {
                    if(attrKey) {
                        attrs[attrKey] = tmp;
                    } else {
                        console.error("Invalid attribute: ", tmp, 'Line dropped.');
                        return;
                    }
                } else {
                    key = tmp;
                }
            }

            for(var i in line) {
                var c = line[i];

                switch(c) {
                case ':':
                    finalizeKeyOrAttr();
                    value = line.slice(Number(i) + 1);
                    callback.apply(
                        this,
                        [key, value, attrs]
                    );
                    return;
                case ';':
                    finalizeKeyOrAttr();
                    tmp = '';
                    break;
                case '=':
                    attrKey = tmp;
                    tmp = '';
                    break;
                default:
                    tmp += c;
                }
            }
        }

    };

})();