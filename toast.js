module.exports = {
  headers: login,
  get_menu_items: get_menu_items,
  get_menu_groups: get_menu_groups,
  get_menu_item_id: get_menu_item_id,
  post_order: post_order
};

var request = require('request');

var toast_urls = {
    local: 'https://services.eng.toasttab.com:10443',
    stage: 'https://ws-stage.eng.toasttab.com:443',
    sandbox: 'https://ws-sandbox.eng.toasttab.com:443'
};

var env = process.env.ENVIRONMENT;

var login_info = {
    grant_type: 'client_credentials',
    client_id: process.env.TOAST_CLIENT_ID,
    client_secret: process.env.TOAST_CLIENT_SECRET
};

var get_paths = {
  menuGroups: '/config/v1/menuGroups',
  menus: '/config/v1/menus',
  menuItems: '/config/v1/menuItems'
};
var login_path = '/usermgmt/v1/oauth/token';
var post_path = '/orders/v1/orders';

var get_cb = function(err, res, body, done) {
  if (err) {
    logger.error(err);
  }
  else if (res.statusCode != 200){
    logger.error('not 200', res);
  }
  else {
    var stuff = JSON.parse(body);
    return done(stuff);
    // logger.info(stuff);
    // return next(stuff);
  }
};

function login(next) {
  request.post({url:toast_urls[env]+login_path, form:login_info}, function(err, res, body) {
    if (err) {
      logger.error(err);
    }
    else if (res.statusCode != 200){
      logger.error(body);
    }
    else {
      var stuff = JSON.parse(body);
      return next({
        Authorization: 'Bearer ' + stuff.access_token,
        'Toast-Restaurant-External-ID': process.env.RESTAURANT_ID
      });
    }
  });
}

function get_menu_items(header, next) {
  request.get({url:toast_urls[env]+get_paths.menuItems, headers: header}, next);
}

function get_menu_item_id(header, id, next) {
  request.get({url:toast_urls[env]+get_paths.menuItems+'/'+id, headers: header}, next);
}

function get_menu_groups(header, next) {
  request.get({url:toast_urls[env]+get_paths.menuGroups, headers: header}, next);
}

function post_order(header, item_guid, group_guid, next) {
  var order = {
    diningOption: {
      guid: process.env.DINE_IN,
      entityType: 'DiningOption'
    },
    checks: [
      {
        selections: [
          {
            item: {
              guid: item_guid,
              entityType: 'MenuItem'
            },
            itemGroup: {
              guid: group_guid,
              entityType: 'MenuGroup'
            },
            quantity: 1
          }
        ]
      }
    ]
  };
  request.post({url:toast_urls[env]+post_path, headers: header, body:JSON.stringify(order)}, next);
}
