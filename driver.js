var Cfg = {
    MaxSteps: 100
};

var Stats = {
    GetSpec: 0,
    ParseSpec: 0,
    Process: 0,
    CrewProcess: 0,
    CrewUpdate: 0,
    SpecCacheHits: 0,
    SpecCacheMisses: 0
};

var DefaultSpecCacheLimit = 128;

var SpecCache = function() {
    var enabled = false;
    var entries = {};
    var limit = DefaultSpecCacheLimit;
    var size = 0;
    var hits = 0, misses = 0;
    var makeRoom = function(n) {
	var keys = Object.keys(entries);
	var evict = (size + n) - limit;
	for (var i = 0; 0 < evict && i < keys.length; i++) {
	    delete entries[keys[i]];
	    size--;
	    evict--;
	}
    };
    return {
	enable: function() {
	    enabled = true;
	},
	disable: function() {
	    enabled = false;
	},
	clear: function() {
	    entries = {};
	    size = 0;
	    hits = 0;
	    misses = 0;
	},
	setLimit: function(n) {
	    limit = n;
	    makeRoom(0);
	},
	add: function(k,v) {
	    if (!enabled) {
		return;
	    }
	    if (limit <= 0) {
		return;
	    }
	    var existing = entries[k];
	    var haveKey = false;
	    if (existing) {
		haveKey = true;
	    }

	    if (!haveKey) {
		makeRoom(1);
	    }
	    if (!haveKey) {
		size++;
	    }
	    entries[k] = v;
	},
	get: function(k) {
	    if (!enabled) {
		return null;
	    }
	    var v = entries[k];
	    if (v) {
		hits++;
		Stats.SpecCacheHits++;
	    } else {
		misses++;
		Stats.SpecCacheMisses++;
	    }
	    return v;
	},
	summary: function() {
	    return {
		size: size,
		numberOfEntries: Object.keys(entries).length,
		limit: limit,
		hits: hits,
		enabled: enabled,
		misses: misses
	    };
	}
    };
}();

function GetSpec(filename) {
    Stats.GetSpec++;
    
    // print("GetSpec " + filename + " (cache size " + SpecCacheLimit + ")");
    
    var cached = SpecCache.get(filename);;

    var cachedString = "";
    if (cached) {
	// print("GetSpec " + filename + " in cache");
	cachedString = cached.string;
    }
    var js = provider(filename, cachedString);
    // js can be null, the same as the given cachedString, or a new
    // string.
    
    if (!js) {
	if (cached) {
	    return cached.spec;
	}
	var err = {filename: filename, error: "not provided"};
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }

    if (js == cachedString) {
	return cached.spec;
    }
    
    var spec = JSON.parse(js);
    Stats.ParseSpec++;
    Object.seal(spec);
    SpecCache.add(filename, {
	    spec: spec,
	    string: js
    });

    return spec;
}

function Process(state_js, message_js) {
    Stats.Process++;
    try {
	var state = JSON.parse(state_js);

	// Don't do anything to the name of the spec that will be
	// handed to the spec provider.  Let the spec provider do
	// what's required.
	var specFilename = state.spec;
	
	var spec = GetSpec(state.spec);
	delete state.spec;
	var message = JSON.parse(message_js);
	
	var stepped = walk(Cfg, spec, state, message);
	
	return JSON.stringify(stepped);
    } catch (err) {
	print("driver Process error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

function Match(_, pattern_js, message_js, bindings_js) {
    try {
	if (bindings_js.length == 0) {
	    bindings_js = "{}";
	}
	var bss = match(null, JSON.parse(pattern_js), JSON.parse(message_js), JSON.parse(bindings_js))
	return JSON.stringify(bss);
    } catch (err) {
	print("driver Match error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

function SetMachine(crew_js, id, specRef, bindings_js, nodeName) {
    try {
	
	var crew = JSON.parse(crew_js);
	var bs = JSON.parse(bindings_js);
	var machines = crew.machines;
	if (!machines) {
	    machines = {};
	    crew.machines = machines;
	}
	machines[id] = {
	    spec: specRef,
	    node: nodeName,
	    bs: bs
	};

	return JSON.stringify(crew);
    } catch (err) {
	print("driver SetMachine error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

function RemMachine(crew_js, id) {
    try {
	
	var crew = JSON.parse(crew_js);
	var machines = crew.machines;
	if (machines) {
	    delete(machines[id]);
	}
	return JSON.stringify(crew);
    } catch (err) {
	print("driver RemMachine error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

function CrewProcess(crew_js, message_js) {
    Stats.CrewProcess++;

    try {
	
	var crew = JSON.parse(crew_js);
	var message = JSON.parse(message_js);

	// Optionally direct the message to a single machine as
	// specified in the message's (optional) "to" property.  For
	// example, if the message has the form {"to":"m42",...}, then
	// that message will be sent to machine m42 only.  Generalize
	// to accept an array: "to":["m42","m43"].

	var targets = message.to;
	if (targets) {
	    // Routing to specific machine(s).
	    if (typeof targets == 'string') {
		targets = [targets];
	    }
	    print("driver CrewProcess routing", JSON.stringify(targets));
	} else {
	    // The entire crew will see this message.
	    targets = []
	    for (var mid in crew.machines) {
		targets.push(mid);
	    }
	}

	var steppeds = {};
	for (var i = 0; i < targets.length; i++) {
	    var mid = targets[i];
	    var machine = crew.machines[mid];
	    if (machine) {
		var spec = GetSpec(machine.spec);
		
		var state = {
		    node: machine.node,
		    bs: machine.bs
		};
		
		steppeds[mid] = walk(Cfg, spec, state, message);
	    } // Otherwise just move on.
	}
	
	return JSON.stringify(steppeds);
    } catch (err) {
	print("driver CrewProcess error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

function CrewUpdate(crew_js, steppeds_js) {
    Stats.CrewUpdate++;
    try {
	
	var crew = JSON.parse(crew_js);
	var steppeds = JSON.parse(steppeds_js);
	for (var mid in steppeds) {
	    var stepped = steppeds[mid];
	    crew.machines[mid].node = stepped.to.node;
	    crew.machines[mid].bs = stepped.to.bs;
	}
	
	return JSON.stringify(crew);
    } catch (err) {
	print("driver CrewUpdate error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

function GetEmitted(steppeds_js) {
    try {
	
	var steppeds = JSON.parse(steppeds_js);
	var emitted = [];
	for (var mid in steppeds) {
	    var stepped = steppeds[mid];
	    var msgs = stepped.emitted;
	    for (var i = 0; i < msgs.length; i++) {
		emitted.push(JSON.stringify(msgs[i]));
	    }
	}
	
	return emitted;
    } catch (err) {
	print("driver GetEmitted error", err, JSON.stringify(err));
	throw JSON.stringify({err: err, errstr: JSON.stringify(err)});
    }
}

// sandbox('JSON.stringify({"bs":{"x":1+2},"emitted":["test"]})');

