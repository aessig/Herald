//allow package users to delay escalations
Meteor.startup(function () {
  //if no pattern is defined then skip this.
  // if (!Herald.settings.delayEscalation) return false;
  if (Package['artwells:queue']) {
    Meteor.setInterval(function ( ){ Queue.run() }, Herald.settings.queueTimer); // by default, once a minute
  }
});


Herald.SetupEscalations = function (notification) {
  if (notification.escalated) return false; //don't resend notifications

  _.each(_.keys(Herald._getCourier(notification.courier).media), function (medium) {
    if (!_.contains(_.keys(Herald._serverRunners), medium)) return; //Server only
    if (!notification.media[medium].send || notification.media[medium].sent) return; //already sent/don't send
    if (Package['artwells:queue']) {
      var command = 'Meteor.call("heraldEscalate","' + notification._id + '", "' + medium + '")';
      Queue.add({ command: command });
    } else {
      Meteor.call("heraldEscalate", notification._id, medium);
    }
  });

  Herald.collection.update(notification._id, { $set: { escalated: true } } );
}

Meteor.methods({
  /**
   * Server method to call Herald.escalate out of the queue package
   *
   * @param {string} notificationId
   * @param {string} medium
   */
  heraldEscalate: function (notificationId, medium) {
    check(notificationId, String);
    check(medium, String);
    try {
      Herald.escalate(notificationId, medium);
    } catch (e) {
      throw new Meteor.Error("Can't start Herald.escalate: " + e);
    }
  }
});


Herald.escalate = function (notificationId, medium) {
  var notification = Herald.collection.findOne(notificationId);
  if (!notification) return; //notification has been removed
  if (notification.read) return; //don't escalate a read notification!
  if (!notification.media[medium].send || notification.media[medium].sent) return; //already sent/don't send
  if (Herald.settings.overrides[medium]) return; //disabled by override

  var user = Meteor.users.findOne(notification.userId);
  if (!user) return; //user has been removed

  var run = true; //does the user want you to send on this medium?
  if (!Herald.userPreference(user, medium, notification.courier)) run = false;

  var courier = Herald._getCourier(notification.courier);
  var courierMedium = courier && courier.media[medium];
  var thisOnRun = courierMedium && courierMedium.onRun;

  if (_.isFunction(thisOnRun)) {
    var result = thisOnRun.call(new onRun(), notification, user, run);
    if (!result.command) throw new Error('Herald:' + medium + ' onRun did not return a command');
    run = onRunResolve(notification, medium, result, run);
  }

  if (run) {
    Herald._serverRunners[medium].call(courierMedium, notification, user);
    var query = Herald._setProperty('media.' + medium, { send: false, sent: true });
  } else {
    var query = Herald._setProperty('media.' + medium + '.send', false);
  }

  Herald.collection.update(notification._id, { $set: query } );
};
