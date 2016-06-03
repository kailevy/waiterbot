var Botkit = require('botkit');
var os = require('os');
var winston = require('winston');
var async = require('async');
var natural = require('natural');
var toast_sesh = require('./toast.js');

global.logger = winston;

if (!process.env.WAITERBOT_TOKEN) {
    logger.error('Error: Specify token in environment');
    process.exit(1);
}

var controller = Botkit.slackbot({
  debug: true
});

var toast_header;
var restaurant_menu = {};
var restaurant_groups = [];
var restaurant_items = [];
var item_ids = {};
var group_ids = {};
var item_groups = {};

var on_start = function () {
  toast_sesh.headers(function (header) {
    toast_header = header;

    toast_sesh.get_menu_groups(toast_header, function(err, res, menu_groups) {
      if (err || res.statusCode != 200) {
        logger.error(err);
        logger.error(res);
        bot.reply(message, 'error!');
      }
      else {
        menu_groups = JSON.parse(menu_groups);
        async.each(menu_groups, function(menu_group, next) {
          if (menu_group.items.length > 0) {
            restaurant_groups.push(menu_group.name);
            var group_name = menu_group.name;
            var group_name_upper = group_name.toUpperCase();
            group_ids[group_name_upper] = menu_group.guid;
            restaurant_menu[group_name_upper] = [];
            async.each(menu_group.items, function(menu_item, done) {
              toast_sesh.get_menu_item_id(toast_header, menu_item.guid, function(err, res, item) {
                if (err || res.statusCode != 200){
                  logger.error(err, res);
                }
                item = JSON.parse(item);
                restaurant_menu[group_name_upper].push(item.name);
                restaurant_items.push(item.name);
                var item_name = item.name;
                var item_name_upper = item_name.toUpperCase();
                item_ids[item_name_upper] = item.guid;
                item_groups[item_name_upper] = group_name_upper;
                done();
              });
            }, function(err) {
              if (err){
                logger.error(err);
              }
              next();
            });
          } else {
            next();
          }
        }, function (err) {
          if (err) {
            logger.error(err);
          }
        });
      }
    });
  });
};

var bot = controller.spawn({
    token: process.env.WAITERBOT_TOKEN
}).startRTM(on_start());

controller.hears(['hello', 'hi'], 'direct_message,direct_mention,mention', function(bot, message) {

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'robot_face',
    }, function(err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji reaction :(', err);
        }
    });


    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Hello ' + user.name + '!!');
        } else {
            bot.reply(message, 'Hello.');
        }
    });
});

controller.hears(['menu', 'hungry', 'eat'], 'direct_message, direct_mention, mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {
    menus_str = '';
    for (var i in restaurant_groups) {
      menus_str += restaurant_groups[i] + ', ';
    }
    convo.say('We have menus for: ' + menus_str);
    convo.ask('What do you want to see?');
  });

});

controller.hears(restaurant_groups, 'direct_message,direct_mention,mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {
    var group_match = String(message.match);
    var upper_match = group_match.toUpperCase();
    convo.ask('You want to see the ' + group_match + ' menu?', [
      {
        pattern: bot.utterances.yes,
        callback: function(response, convo) {
          var menu_str = '';
          for (var j in restaurant_menu[upper_match]){
            menu_str += restaurant_menu[upper_match][j] + ', ';
          }
          convo.say(menu_str);
          convo.next();
        }
      },
      {
        pattern: bot.utterances.no,
        default: true,
        callback: function(response, convo) {
          convo.say('Your loss');
          convo.next();
        }
      }
    ]);
  });
});

controller.hears(restaurant_items, 'direct_message,direct_mention,mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {
    var item_match = String(message.match);
    var upper_match = item_match.toUpperCase();
    convo.ask('You want to order the ' + match + '?', [
      {
        pattern: bot.utterances.yes,
        callback: function(response, convo) {
          convo.say('Coming right up!');
          bot.api.reactions.add({
              timestamp: response.ts,
              channel: message.channel,
              name: 'datboi',
          }, function(err, res) {
              if (err) {
                  bot.botkit.log('Failed to add emoji reaction :(', err);
              }
          });
          toast_sesh.post_order(toast_header, item_ids[upper_match], group_ids[item_groups[upper_match]], function(e, res, order_response) {
            if (e) {
              logger.error(e);
              convo.say('Error :(');
              convo.next();
            }
            else if (res.statusCode != 200){
              logger.error(e);
              convo.say('Error :( status code:' + res.statusCode);
              convo.next();
            }
            else {
              order_response = JSON.parse(order_response);
              logger.info(order_response.checks);
              convo.say('Your order has been placed!');
              var price = order_response.checks[0].totalAmount;
              convo.say('That will be $' + price + ' due to the restaurant, plus a service fee (due to yours truly) of $' + price*100 + '.00');
              convo.say('You can check on your order with the id: ' + order_response.guid);
              controller.storage.users.get(message.user, function(errr, user_data) {
                if (!user_data) {
                    user_data = {
                        id: message.user,
                    };
                }
                if (user_data.total === undefined){
                  user_data.total = 0;
                }
                if (user_data.number === undefined) {
                  user_data.number = 0;
                }
                var total = user_data.total + price * 101;
                var number = user_data.number + 1;
                user_data.total = total;
                user_data.number = number;
                controller.storage.users.save(user_data, function(error) {
                  if (error){
                    logger.error(err);
                  }
                  convo.say('Saving records...');
                  convo.next();
                });
              });
            }
          });
        }
      },
      {
        pattern: bot.utterances.no,
        default: true,
        callback: function(response, convo) {
          bot.api.reactions.add({
              timestamp: response.ts,
              channel: message.channel,
              name: 'expressionless',
          }, function(err, res) {
              if (err) {
                  bot.botkit.log('Failed to add emoji reaction :(', err);
              }
          });
          convo.say('Captain indecisive here...');
          convo.next();
        }
      }
    ]);
  });
});

controller.hears(['how much', 'owe'], 'direct_message,direct_mention,mention', function(bot, message) {
  controller.storage.users.get(message.user, function(err, user_data) {
    if (!user_data) {
        user_data = {
            id: message.user,
        };
    }
    if (user_data.total === undefined){
      logger.info('here');
      user_data.total = 0;
    }
    var reply = 'You are $' + user_data.total + ' in debt!';
    if (user_data.total < 1){
      reply += ' Start ordering already';
    }
    if (user_data.total > 5000){
      reply += ' My wallet thanks you!';
    }
    bot.reply(message, reply);
  });
});


controller.hears(['how many'], 'direct_message,direct_mention,mention', function(bot, message) {
  controller.storage.users.get(message.user, function(err, user_data) {
    if (!user_data) {
        user_data = {
            id: message.user,
        };
    }
    if (user_data.number === undefined){
      logger.info('hafew');
      user_data.number = 0;
    }
    var reply = 'You\'ve ordered ' + user_data.number + ' items!';
    if (user_data.number < 1){
      reply += ' Start ordering already';
    }
    if (user_data.number > 6){
      reply += ' Yeesh!';
    }
    bot.reply(message, reply);
  });
});


controller.hears(['call me (.*)', 'my name is (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var name = message.match[1];
    controller.storage.users.get(message.user, function(err, user) {
        if (!user) {
            user = {
                id: message.user,
            };
        }
        user.name = name;
        controller.storage.users.save(user, function(err, id) {
            bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
        });
    });
});

controller.hears(['what is my name', 'who am i'], 'direct_message,direct_mention,mention', function(bot, message) {

    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Your name is ' + user.name);
        } else {
            bot.startConversation(message, function(err, convo) {
                if (!err) {
                    convo.say('I do not know your name yet!');
                    convo.ask('What should I call you?', function(response, convo) {
                        convo.ask('You want me to call you `' + response.text + '`?', [
                            {
                                pattern: 'yes',
                                callback: function(response, convo) {
                                    // since no further messages are queued after this,
                                    // the conversation will end naturally with status == 'completed'
                                    convo.next();
                                }
                            },
                            {
                                pattern: 'no',
                                callback: function(response, convo) {
                                    // stop the conversation. this will cause it to end with status == 'stopped'
                                    convo.stop();
                                }
                            },
                            {
                                default: true,
                                callback: function(response, convo) {
                                    convo.repeat();
                                    convo.next();
                                }
                            }
                        ]);

                        convo.next();

                    }, {'key': 'nickname'}); // store the results in a field called nickname

                    convo.on('end', function(convo) {
                        if (convo.status == 'completed') {
                            bot.reply(message, 'OK! I will update my dossier...');

                            controller.storage.users.get(message.user, function(err, user) {
                                if (!user) {
                                    user = {
                                        id: message.user,
                                    };
                                }
                                user.name = convo.extractResponse('nickname');
                                controller.storage.users.save(user, function(err, id) {
                                    bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
                                });
                            });



                        } else {
                            // this happens if the conversation ended prematurely for some reason
                            bot.reply(message, 'OK, nevermind!');
                        }
                    });
                }
            });
        }
    });
});


controller.hears(['shutdown'], 'direct_message,direct_mention,mention', function(bot, message) {

    bot.startConversation(message, function(err, convo) {

        convo.ask('Are you sure you want me to shutdown?', [
            {
                pattern: bot.utterances.yes,
                callback: function(response, convo) {
                    convo.say('Bye!');
                    convo.next();
                    setTimeout(function() {
                        process.exit();
                    }, 3000);
                }
            },
        {
            pattern: bot.utterances.no,
            default: true,
            callback: function(response, convo) {
                convo.say('*Phew!*');
                convo.next();
            }
        }
        ]);
    });
});


controller.hears(['uptime', 'identify yourself', 'who are you', 'what is your name'],
    'direct_message,direct_mention,mention', function(bot, message) {

        var hostname = os.hostname();
        var uptime = formatUptime(process.uptime());

        bot.reply(message,
            ':robot_face: I am a bot named <@' + bot.identity.name +
             '>. I have been running for ' + uptime + ' on ' + hostname + '.');

    });

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit + 's';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}
