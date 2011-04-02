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
  var internalListenIp = '127.0.0.1';
  var internalListenPort = '4000';
  
  var userTimeout = 360000;
  var holdTimeout = 120000;
  var manageTimeout = 60000;
  var contentType = 'text/javascript';
  
  var neighbours = [];
  var initialNeighbours = [];
  
  //Stats
  var sendRequests = 0;
  var messagesSent = 0;
  var messagesDelivered = 0;
  
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
      sendRequests++;
      
      if(request.method == 'GET')
      {
        //Check parameters
        if(!query.user || !query.to || !query.message)
        {
          response.writeHead(200, {'Content-Type': contentType});
          response.end('{"status":"fail","error":"wrong parameters"}');
          return;
        }
        
        //Check user availability
        if(!users[to] && !neighbourUsers[to])
        {
          response.writeHead(200, {'Content-Type': contentType});
          response.end('{"status":"user_unavailable"}');
          return;
        }
         
        handleSend(query.user, query.to, query.message, response);
      } 
      else if(request.method == 'POST') 
      {
        request.user = query.user;
        request.content = [];
        request.response = response;
        
        request.addListener("data", function(chunk) {
          request.content.push(chunk);
        });
       
        request.addListener("end", function() {
          try {
            var contentObj = JSON.parse(this.content.join());
            
            //Multi message
            if(contentObj.messages) {
              var states = [];
              for(var k in contentObj.messages) {
                if(!users[contentObj.messages[k].to] && !neighbourUsers[contentObj.messages[k].to])
                {
                  states.push('{"to": ' + contentObj.messages[k].to + ', "status":"user_unavailable"}');
                } else {
                  states.push('{"to": ' + contentObj.messages[k].to + ', "status":"ok"}');
                }
                
                handleSend(this.user, contentObj.messages[k].to, JSON.stringify(contentObj.messages[k].message));
              }
              this.response.writeHead(200, {'Content-Type': contentType});
              this.response.end('{"states":[' + states.join(',') + ']}');
            } else {
              //Check user availability
              if(!users[contentObj.to] && !neighbourUsers[contentObj.to])
              {
                response.writeHead(200, {'Content-Type': contentType});
                response.end('{"status":"user_unavailable"}');
                return;
              }
              
              this.response.writeHead(200, {'Content-Type': contentType});
              this.response.end('{"status":"ok"}');
            
              handleSend(this.user, contentObj.to, JSON.stringify(contentObj.message));
            }
          } catch(e) {
            //TODO: Log
            sys.puts('Send Error: ' + e + ' Message: ' + this.content.join());
            response.writeHead(200, {'Content-Type': contentType});
            response.end('{"status":"fail", "error":"' + e + '", "message":"' + this.content.join().replace(/"/g, '\\"') + '"}');
            return;
          }   
        });
      }
            
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
        messagesDelivered++;
        users[query.user].holds[query.session].response.writeHead(200, {'Content-Type': contentType});
        users[query.user].holds[query.session].response.end('{"status":"ok", "from": ' + query.user + ', "message": ' + users[query.user].holds[query.session].queue.shift() + '}');
        users[query.user].holds[query.session].response = null;
      }
    }
  }
  
  /**
   * Handle send
   */
  var handleSend = function(from, to, message) {
    
    if(users[to])
      sendMessage(from, to, message);
      
    if(neighbourUsers[to])
      sendNeighbourMessage(from, to, message);
      
  };
  
  /**
   * Deliver a message to the other side
   */
  var sendMessage = function(from, to, message) {
    messagesSent++;
    //Check user holding lines
    for(var k in users[to].holds)
    {
      if(users[to].holds[k].response)
      {
        messagesDelivered++;
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
    sys.puts('Send Requests: ' + sendRequests + ' - Messages sent: ' + messagesSent + ' - Messages delivered: ' + messagesDelivered);
    setTimeout(_manageCycle, manageTimeout);
  };
  
  /**
   * Handle an HTTP request for the MessageBox
   */
  var _requestHandler = function(request, response) {
    try {
      var parsedUrl = url.parse(request.url, true);
      var query;
      
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
    } catch(e) {
      //TODO: Log
      response.writeHead(200, {'Content-Type': contentType});
      response.end('{"status":"fail", "error":"' + e + '"}');
      return;
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
  
  var sendUsers = function(socket) {
    if(users.length > 0)
    {
      var answer = {
        type: 'addusers',
        users: []
      };
      for(var k in users)
        answer.users.push(k);
      socket.write(JSON.stringify(answer));
    }
  };
    
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
              this.write(JSON.stringify({type: 'welcome', port: internalListenPort}));
              sendUsers(this);
              //TODO: tell new neighbour about other neighbours
              //TODO: Handle neighbour disconnect
            });
            neighbours[this.remoteAddress] = neighbourConnection;
          break;
        case 'welcome':
            sys.puts('received welcome ' + this.remoteAddress + ':' + dataObj[m].port);
            //Tell new neighbour about users on this side
            var neighbourConnection = net.createConnection(dataObj[m].port, this.remoteAddress);
            neighbourConnection.addListener('connect', function(){
              sendUsers(this);
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
  
  //Startup
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
  
  /**
   * Listen for other MessageBox instances
   */
  var internalServer = net.createServer(function(socket){
    sys.puts('received neighbour connect');
    socket.addListener('data', internalDataHandler);
  }).addListener('data', internalDataHandler);
  internalServer.listen(internalListenPort, internalListenIp);
  sys.puts('Internal listening on ' + internalListenIp + ':' + internalListenPort);
  
  //Announce this instance to neighbours, if given
  for(var n in initialNeighbours){
    var neighbourConnection = net.createConnection(initialNeighbours[n].port, initialNeighbours[n].ip);
    neighbourConnection.addListener('connect', function(){
      this.write(JSON.stringify({type: 'hello', port: internalListenPort}));
    });
  }
  
  var _server = http.createServer().
          addListener('request', _requestHandler)
          .addListener('close', _closeHandler)
          .addListener('update', _updateHandler)
          .listen(externalListenPort, externalListenIp);
  sys.puts('External listening on ' + externalListenIp + ':' + externalListenPort);
};

new MessageBox();