/**
 * MessageBox - JSON Message Passing
 * 
 * Author: Sebastian Herrlinger <sebastian@formzoo.com
 * License: MIT
 */
  
var events = require('events');
var sys = require('sys');
var http = require('http');
var fs = require('fs');
var url = require('url');

var MessageBox = function() {
  var _self = this;
  _self.users = [];
  var userTimeout = 360000;
  var holdTimeout = 120000;
  var manageTimeout = 60000;
  var contentType = 'text/javascript';
  
  /**
   * These are the routes that can be reached over the URL
   */
  var routes = {
    '/' : function(request, response, query) {
      response.writeHead(200, {'Content-Type': 'text/html'});
      response.end(_self.indexTemplate);
    },
    
    '/jquery.js' : function(request, response, query) {
      response.writeHead(200, {'Content-Type': 'text/javascript'});
      response.end(_self.jquery);
    },
    
    '/sender' : function(request, response, query) {
      response.writeHead(200, {'Content-Type': 'text/html'});
      response.end(_self.sender);
    },
    
    '/receiver' : function(request, response, query) {
      response.writeHead(200, {'Content-Type': 'text/html'});
      response.end(_self.receiver);
    },
    
    '/send' : function(request, response, query) {
        
      //Check parameters
      if(!query.user || !query.to || !query.message)
      {
        response.writeHead(200, {'Content-Type': contentType});
        response.end('{"status":"fail"}');
        return;
      }
      
      //Check user availability
      if(!_self.users[query.to])
      {
        response.writeHead(200, {'Content-Type': contentType});
        response.end('{"status":"user_unavailible"}');
        return;
      }
      //Check user holding lines
      
      for(var k in _self.users[query.to].holds)
      {
        if(_self.users[query.to].holds[k].response)
        {
          _self.users[query.to].holds[k].response.writeHead(200, {'Content-Type': contentType});
          _self.users[query.to].holds[k].response.end('{"status":"ok", "from": ' + query.user + ', "message": ' + query.message + '}');
          _self.users[query.to].holds[k].response = null;
        } else {
          _self.users[query.to].holds[k].queue.push(query.message);
        }
      }
            
      response.writeHead(200, {'Content-Type': contentType});
      response.end('{"status":"ok"}');
    },

    '/receive' : function(request, response, query) {
      if(!query.user || !query.session)
      {
        response.writeHead(200, {'Content-Type': contentType});
        response.end('{"status":"fail"}');
        return;
      }
      
      //Register receiver if not there yet
      if(!_self.users[query.user].holds[query.session])
      {
        _self.users[query.user].holds[query.session] = {
          response: null,
          timeout: 0,
          queue: []
        }
      }
      
      //Set new receiver timeout
      _self.users[query.user].holds[query.session].timeout = new Date().getTime();
      _self.users[query.user].holds[query.session].response = response;
      
      //TODO: respond with many messages
      if(_self.users[query.user].holds[query.session].queue.length > 0)
      {
        _self.users[query.user].holds[query.session].response.writeHead(200, {'Content-Type': contentType});
        _self.users[query.user].holds[query.session].response.end('{"status":"ok", "from": ' + query.user + ', "message": ' + _self.users[query.user].holds[query.session].queue.shift() + '}');
        _self.users[query.user].holds[query.session].response = null;
      }
    }
  }
  
  /**
   * The manage cycle checks for timeouts and does clean up
   */
  var _manageCycle = function(){
    sys.puts('managing...');
    var now = new Date().getTime();
    for(var k in _self.users){
      if(now - _self.users[k].timeout > userTimeout){
        delete _self.users[k];
      } else {
        for(var h in _self.users[k].holds)
        {
          if(now - _self.users[k].holds[h].timeout > holdTimeout)
          {
            sys.puts('remove hold: ' + k + '/' + h);
            if(_self.users[k].holds[h].response != null)
            {
              _self.users[k].holds[h].response.writeHead(200, {'Content-Type': 'text/javascript'});
              _self.users[k].holds[h].response.end('{"status":"timeout"}');
            }
            delete _self.users[k].holds[h];
          }
        }
      }
    }
    setTimeout(_manageCycle, manageTimeout);
  };
  
  /**
   * Handle an HTTP request for the MessageBox
   */
  var _requestHandler = function(request, response) {
    //sys.puts('request: \'' + request.url + '\'');
    
    var parsedUrl = url.parse(request.url, true);
    
    //If user is not already registered, do so (here authentication could happen)
    if(parsedUrl.query.user && _self.users[parsedUrl.query.user] == undefined)
    {
      sys.puts('create user: \'' + parsedUrl.query.user + '\'');
    
      _self.users[parsedUrl.query.user] = {
        timeout: new Date().getTime(),
        holds: {}
      }
    }
    else if(parsedUrl.query.user && _self.users[parsedUrl.query.user]) {
      _self.users[parsedUrl.query.user].timeout = new Date().getTime()
    }
    
    if(routes[parsedUrl.pathname] === undefined) {
      response.writeHead(404, {'Content-Type': 'text/plain'});
      response.write('not found\n');
      response.end();
    } else {
      routes[parsedUrl.pathname].call(this, request, response, parsedUrl.query);
    }
  };
  
  var _updateHandler = function(request, socket, head) {
    sys.puts('update');
  };

  var _closeHandler = function() {
    sys.puts('close');
  };
  
  sys.puts('New MessageBox');
  
  //Load index.html
  fs.readFile('./index.html', function (err, data) {
    if (err) throw new Error('index.html could not be loaded.');
    _self.indexTemplate = data;
    sys.puts('Index loaded.');
  });
  
  //Load jquery.js
  fs.readFile('../lib/jquery.js', function (err, data) {
    if (err) throw new Error('jquery.js could not be loaded.');
    _self.jquery = data;
    sys.puts('jquery loaded.');
  });
  
  //Load sender.html
  fs.readFile('./sender.html', function (err, data) {
    if (err) throw new Error('sender.html could not be loaded.');
    _self.sender = data;
    sys.puts('sender loaded.');
  });
  
  //Load receiver.html
  fs.readFile('./receiver.html', function (err, data) {
    if (err) throw new Error('receiver.html could not be loaded.');
    _self.receiver = data;
    sys.puts('receiver loaded.');
  });
  
  //Start manage cycle
  setTimeout(_manageCycle, manageTimeout);
  
  var _server = http.createServer().
          addListener('request', _requestHandler)
          .addListener('close', _closeHandler)
          .addListener('update', _updateHandler)
          .listen(8000);
  sys.puts('Listening on port 8000');
};

new MessageBox();