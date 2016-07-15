Herald.addRunner = function (object) {
  if (!_.isObject(object)) throw new Error('Herald: Runner must have an `object` argument');
  if (! _.isString(object.name)) throw new Error('Herald: Runner must medium `name`');
  if (!_.isFunction(object.run)) throw new Error('Herald: Runner must have a `run` function');
  if (!_.isFunction(object.check)) throw new Error('Herald: Runner must have a `check` function');
  if (! (_.isArray(object.where) || _.isString(object.where)))
    throw new Error('Herald: Runner `where` must be a valid environment');

  var where = _.isString(object.where) ? [object.where] : object.where;

  _.each(where, function (where) {
    if (where === 'server')
      Herald._serverRunners[object.name] = object.run;
    if (where === 'client')
      Herald._clientRunners[object.name] = object.run;
  });

  Herald._runnerCheckers[object.name] = object.check;
}


onRun = function () {};
onRun.prototype.run = function () {
  return { command: 'run' };
};

onRun.prototype.stop = function () {
  return { command: 'stop' };
};

onRun.prototype.delay = function (time) {
  return { command: 'delay', time: time };
};

onRun.prototype.transfer = function (name, time) {
  return { command: 'transfer', name: name, time: time };
};


onRunResolve = function (notification, medium, result, run) {
  switch (result.command) {
    case 'run':
      //run true, but invalidation could have been triggered elsewhere so don't change
      break;
    case 'stop':
      run = false;
      break;
    case 'delay':
      run = false;
      if (Herald._serverRunners[medium]) { //will only be called on server, no method needed
        var query = Herald._setProperty('media.' + medium + '.send', true);
        var command = 'Herald.escalate("' + notification._id + '", "' + medium + '")';
        Herald.collection.update(notificationId, { $set: query }, function (err, count) {
          Queue.add({ command: command, execute_after: result.time });
        });
      }
      if (Herald._clientRunners[medium]) {
        var delay = result.time.getTime() - new Date().getTime();
        Meteor.call('HeraldUpdateAndDelay', notification._id, medium, delay);
      }
      break;
    case 'transfer':
      run = false;
      if (!Herald._clientRunners[result.name] && !Herald._serverRunners[result.name])
        throw new Error('Herald: '+ medium +' transfer call - no medium '+ result.name);
      if (Herald._serverRunners[result.name])
        Meteor.call('HeraldTransferServerMedium', notification._id, result);
      if (Herald._clientRunners[result.name]) {
        var delay = result.time && result.time.getTime() - new Date().getTime();
        var query = Herald._setProperty('media.' + result.name, true);
        Meteor.call('HeraldUpdateAndDelay', notification._id, query, delay);
      }
      break;
    default:
      throw new Error('Herald:' + medium + ' onRun returned the unknown command ' + result.command);
  }
  return run;
}

Meteor.methods({
  HeraldTransferServerMedium: function (notificationId, result) {
    check(notificationId, String);
    check(result, Object);

    var notification = Herald.collection.findOne(notificationId);
    var courier = Herald._getCourier(notification.courier);

    if (this.userId !== notification.userId) throw new Meteor.Error(550, 'Herald: permission denied');
    if (courier && !courier.media[result.name])
      throw new Error('Herald: ' + notification.courier + ' transfer call - no medium '+ result.name);

    var command = 'Herald.escalate("' + notification._id + '", "' + result.name + '")';
    if (Meteor.isServer) {//simulation causes errors
      var query = Herald._setProperty('media.' + result.name + '.send', true);

      Herald.collection.update(notificationId, { $set: query }, function (err, count) {
        if (result.time)
          if (Package['artwells:queue']) {
            Queue.add({ command: command, execute_after: result.time });
          } else {
            //TODO: how are we going to do delays without a queue?
            //Herald.escalate(notification._id, result.name);
            throw new Meteor.error('Herald: delay is not available without artwells:queue');
          }
        else
          if (Package['artwells:queue']) {
            Queue.add({ command: command });
          } else {
            Herald.escalate(notification._id, result.name);
          }
      });
    }
  },
  HeraldUpdateAndDelay: function (notificationId, query, delay) {
    check(notificationId, String);
    check(query, Object);
    check(delay, Number);

    if (!delay || delay < 1000) delay = 1000; //give at least one second for the dust to settle
    var notification = Herald.collection.findOne(notificationId);
    if (this.userId !== notification.userId) throw new Meteor.Error(550, 'Herald: permission denied');
    if (!this.isSimulation) {
      Meteor.setTimeout(function () {
        Herald.collection.update(notificationId, { $set: query });
      }, delay);
    }
  }
});
