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
var net = require('net');

var MessageBox = function() {
  var _self = this;
  users = [];
  neighbourUsers = [];
  
  var externalListenIp = null;
  var externalListenPort = '8000';
  var internalListenIp = null;
  var internalListenPort = '4000';
  
  var userTimeout = 360000;
  var holdTimeout = 120000;
  var manageTimeout = 60000;
  var contentType = 'text/javascript';
  
  var neighbours = [];
  var initialNeighbours = [];
  
  //Read arguments
  process.argv.forEach(function (val, index, array) {
    if(index < 2)
      return;
    var valArr = val.split('=');
    switch(valArr[0]){
      case 'neighbour':
      case 'n':
          var neighbour = {
            ip: valArr[1].substr(0, valArr[1].lastIndexOf(':')) ,
            port: valArr[1].substr(valArr[1].lastIndexOf(':') + 1, valArr[1].length)
          };
          initialNeighbours.push(neighbour);
        break;
      case 'userTimeout':
      case 'ut':
          userTimeout = valArr[1] * 1000;
        break;
      case 'holdTimeout':
      case 'ht':
          holdTimeout = valArr[1] * 1000;
        break;
      case 'manageTimeout':
      case 'mt':
          manageTimeout = valArr[1] * 1000;
        break;
      case 'externalIp':
      case 'exip':
          externalListenIp = valArr[1];
        break;
      case 'externalPort':
      case 'exp':
          externalListenPort = valArr[1];
        break;
      case 'internalIp':
      case 'inip':
          internalListenIp = valArr[1];
        break;
      case 'internalPort':
      case 'inp':
          internalListenPort = valArr[1];
        break;
      default:
        sys.puts('Argument unknown: ' + valArr[0]);
    }
  });
  
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
      if(!users[query.to] && !neighbourUsers[query.to])
      {
        response.writeHead(200, {'Content-Type': contentType});
        response.end('{"status":"user_unavailible"}');
        return;
      }
           
      if(users[query.to])
        sendMessage(query.user, query.to, query.message);
        
      if(neighbourUsers[query.to])
        sendNeighbourMessage(query.user, query.to, query.message);
        
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
      if(!users[query.user].holds[query.session])
      {
        users[query.user].holds[query.session] = {
          response: null,
          timeout: 0,
          queue: []
        }
      }
      
      //Set new receiver timeout
      users[query.user].holds[query.session].timeout = new Date().getTime();
      users[query.user].holds[query.session].response = response;
      
      //TODO: respond with many messages
      if(users[query.user].holds[query.session].queue.length > 0)
      {
        users[query.user].holds[query.session].response.writeHead(200, {'Content-Type': contentType});
        users[query.user].holds[query.session].response.end('{"status":"ok", "from": ' + query.user + ', "message": ' + users[query.user].holds[query.session].queue.shift() + '}');
        users[query.user].holds[query.session].response = null;
      }
    }
  }
  
  /**
   * Deliver a message to the other side
   */
  var sendMessage = function(from, to, message) {
    //Check user holding lines
    for(var k in users[to].holds)
    {
      if(users[to].holds[k].response)
      {
        users[to].holds[k].response.writeHead(200, {'Content-Type': contentType});
        users[to].holds[k].response.end('{"status":"ok", "from": ' + from + ', "message": ' + message + '}');
        users[to].holds[k].response = null;
      } else {
        users[to].holds[k].queue.push(message);
      }
    }
  };
  
  /**
   * Deliver a message to a user on another server
   */
  var sendNeighbourMessage = function(from, to, message) {
    //Check user holding lines
    neighbourUsers[to].write(JSON.stringify({
      type: 'message',
      from: from,
      to: to,
      message: message
    }));
  };
  
  /**
   * The manage cycle checks for timeouts and does clean up
   * TODO: Remove user on neighbours
   */
  var _manageCycle = function(){
    var now = new Date().getTime();
    for(var k in users){
      if(now - users[k].timeout > userTimeout){
        delete users[k];
      } else {
        for(var h in users[k].holds)
        {
          if(now - users[k].holds[h].timeout > holdTimeout)
          {
            if(users[k].holds[h].response != null)
            {
              users[k].holds[h].response.writeHead(200, {'Content-Type': 'text/javascript'});
              users[k].holds[h].response.end('{"status":"timeout"}');
            }
            delete users[k].holds[h];
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
    var parsedUrl = url.parse(request.url, true);
    
    //If user is not already registered, do so (here authentication could happen)
    if(parsedUrl.query.user && users[parsedUrl.query.user] == undefined)
    {
      createUser(parsedUrl.query.user);
      
      //Tell neighbours
      for(var k in neighbours){
        sys.puts('send user to neighbour ' + k);
        neighbours[k].write(JSON.stringify({
          type: 'adduser',
          user: parsedUrl.query.user
        }));
      }
    }
    else if(parsedUrl.query.user && users[parsedUrl.query.user]) {
      users[parsedUrl.query.user].timeout = new Date().getTime()
    }
    
    if(routes[parsedUrl.pathname] === undefined) {
      response.writeHead(404, {'Content-Type': 'text/plain'});
      response.write('not found\n');
      response.end();
    } else {
      routes[parsedUrl.pathname].call(this, request, response, parsedUrl.query);
    }
  };
  
  /**
   * Create a user and announce it to neighbours
   */
  var createUser = function(id) {
    sys.puts('create user: \'' + id + '\'');
    users[id] = {
      timeout: new Date().getTime(),
      holds: {}
    }
  };
  
  var _updateHandler = function(request, socket, head) {
    sys.puts('update');
  };

  var _closeHandler = function() {
    sys.puts('close');
  };
  
  sys.puts('New MessageBox');
  
  //Startup
  
  /**
   * Listen for other MessageBox instances
   */
  var internalServer = net.createServer(function(socket){
    sys.puts('received neighbour connect');
    socket.addListener('data', internalDataHandler);
    neighbours[socket.remoteAddress] = socket;
  });
  internalServer.listen(internalListenPort, internalListenIp);
  sys.puts('Internal listening on ' + internalListenIp + ':' + internalListenPort);
  
  //Announce this instance to neighbours, if given
  for(var n in initialNeighbours){
    var neighbourConnection = net.createConnection(initialNeighbours[n].port, initialNeighbours[n].ip);
    neighbourConnection.addListener('connect', function(){
      this.write(JSON.stringify({type: 'hello', port: internalListenPort}));
    });
    neighbours[initialNeighbours[n].ip] = neighbourConnection;
  }
  
  /**
   * Handles internal communication
   */
  var internalDataHandler = function(data){
    var dataObj = [];
    try {
      dataObj[0] = JSON.parse(String(data));
    } catch (e){
      try {
        //Sometimes there are > 1 messages in data, try to recover from that
        var dataMsgArr = String(data).split('}{');
        for(var i = 0; i < dataMsgArr.length; i++)
        {
          if(dataMsgArr[i][0] != '{')
            dataMsgArr[i] = '{' + dataMsgArr[i];
          if(dataMsgArr[i][dataMsgArr[i].length - 1] != '}')
            dataMsgArr[i] += '}';
          dataObj.push(JSON.parse(String(dataMsgArr[i])));
        }
      } catch(e){
        sys.puts('Failed internal message ' + data + "\nError: " + e);
        return;
      }
    }
    
    //Handle each message
    for(var m in dataObj) {
      switch(dataObj[m].type){
        case 'hello':
            sys.puts('received hello ' + this.remoteAddress + ':' + dataObj[m].port);
            //Tell new neighbour about users on this side
            var neighbourConnection = net.createConnection(dataObj[m].port, this.remoteAddress);
            neighbourConnection.addListener('connect', function(){
              var answer = {
                type: 'addusers',
                users: []
              };
              for(var k in users)
                answer.users.push(k);
              this.write(JSON.stringify(answer));
              //TODO: tell new neighbour about other neighbours
              //TODO: Handle neighbour disconnect
            });
            neighbours[this.remoteAddress] = neighbourConnection;
          break;
        case 'addusers':
          sys.puts('received addusers');
          for(var k in dataObj[m].users)
            neighbourUsers[dataObj[m].users[k]] = neighbours[this.remoteAddress];
          break;
        case 'adduser':
          sys.puts('received neighbour adduser ' + dataObj[m].user);
          neighbourUsers[dataObj[m].user] = neighbours[this.remoteAddress];
          break;
        case 'message':
          //Put message through to user
          sendMessage(dataObj[m].from, dataObj[m].to, dataObj[m].message);
          break;
        default:
          sys.puts('neighbour message unknown: ' + data);
      }
    }
  };
  
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
          .listen(externalListenPort, externalListenIp);
  sys.puts('External listening on ' + externalListenIp + ':' + externalListenPort);
};

new MessageBox();