var _ = require('./util');

var Steps = ['play', 'form', 'result'];

function InstantWin(CurrentUser, Ship) {
  var CHANGE_EVENT = ["SHIP_CHANGE", Math.floor(Math.random() * 100000000000)].join('_');

  var AppState = {};

  function initState(user, ship) {
    AppState = {
      ship: _.omit(ship, 'settings', 'resources', 'translations'),
      settings: ship.settings,
      form: ship.resources.form,
      achievement: ship.resources.instant_win,
      translations: ship.translations,
      user: user,
      badge: (ship.resources.instant_win && ship.resources.instant_win.badge)
    };
    emitChange();
    return AppState;
  };

  function emitChange(tmp) {
    var s = getAppState(tmp);
    Hull.emit(CHANGE_EVENT, s);
  }

  // Customization support

  function updateSettings(settings) {
    AppState.settings = settings;
    emitChange({ changed: 'settings' });
  }

  function updateTranslations(translations) {
    AppState.translations = translations;
    emitChange({ changed: 'translations' });
  }

  // User actions

  function processFormData(formData) {
    var fields = AppState.form.fields_list;
    var ret = fields.reduce(function(data, field) {
      var val = formData[field.name];
      if (val.toString().length > 0) {
        switch (field.field_type) {
          case 'date':
            res = new Date(val).toISOString().substring(0,10);
            break;
          default:
            res = formData[field.name];
        }
        data[field.name] = res;
      }
      return data;
    }, {});
    return ret;
  }

  function submitForm(formData) {
    var data = processFormData(formData);
    emitChange({ changed: 'loading', loading: 'form' });
    Hull.api(AppState.form.id + "/submit", { data: data }, 'put').then(function(form) {
      AppState.form = form;
      emitChange({ changed: 'form' });
    }, function(err) {
      emitChange({ error_message: 'invalid_form', error: err });
    });
  }

  function play(provider) {
    if (userCanPlay()) {
      emitChange({ changed: 'loading', loading: 'badge' });
      return Hull.api(AppState.achievement.id + "/achieve", 'post').then(function(badge) {
        AppState.badge = badge;
        emitChange({ changed: 'badge' });
      }, function(err) {
        emitChange({ error_message: 'error_on_achieve', error: err });
      });
    } else if (provider && !AppState.user) {
      loginAndPlay(provider);
    } else {
      emitChange({ error_message: 'user_cannot_play' });
    }
  }

  var autoPlay = false;
  function loginAndPlay(provider, options) {
    if (provider) {
      autoPlay = true;
      emitChange({ isLoggingIn: true });
      Hull.login(provider, options);
    } else {
      throw "[InstantWin] Error in loginAndPlay method: missing `provider`";
    }
  }

  // State management

  function getAppState(tmp) {
    var step = currentStep();
    var ret = _.extend({}, AppState, {
      userCanPlay: userCanPlay(),
      userHasPlayed: userHasPlayed(),
      userHasWon: userHasWon(),
      currentStep: step,
      currentStepIndex: stepIndex(step),
      isFormComplete: isFormComplete(),
    }, tmp);
    return _.deepClone(ret);
  }

  function userCanPlay() {
    return canPlay() === true;
  }

  function canPlay() {
    if (!AppState.user) return "No current user";
    if (userHasWon()) return "Already won";
    var badge = AppState.badge;
    if (!badge || !badge.data.attempts) return true;
    var d = new Date().toISOString().slice(0, 10);
    if (badge.data.attempts[d]) {
      return "One attempt already today";
    } else {
      return true;
    }
  }

  function userHasPlayed() {
    return !!AppState.badge;
  }

  function userHasWon() {
    var badge = AppState.badge;
    if (!badge || !badge.data) return false;
    return badge.data.winner === true;
  }

  function currentStep() {
    if (!AppState.user || userCanPlay()) return 'play';
    if (!isFormComplete()) return 'form';
    return 'result';
  }

  function stepIndex(step) {
    return Steps.indexOf(step);
  }

  function isFormComplete() {
    if (!AppState.user) return false;
    var fields = AppState.form && AppState.form.fields_list;
    var ret = AppState.form.user_data.created_at && fields && fields.reduce(function(res, field) {
      return res && !!field.value;
    }, true);
    return ret || false;
  }

  function reset() {
    if (AppState.user.is_admin) {
      emitChange({ loading: 'reset' });
      if (AppState.badge && AppState.badge.id) {
        Hull.api(AppState.badge.id, 'delete', function() {
          AppState.badge = null;
          Hull.api(AppState.form.id + '/submit', 'delete', function(form) {
            AppState.form = form;
            emitChange({ changed: 'reset' });
          });
        }, function(err) {
          emitChange({ error_message: 'error_deleting_badge', error: err });
        });
      } else {
        emitChange({ changed: 'reset' });
        throw "[InstantWin] No badge found here...";
      }
    } else {
      throw "[InstantWin] You need to be a administrator to reset badges";
    }
  }

  function translate(lang) {
    var ret = AppState.translations[lang] || AppState.translations['en'] || {};
    var result = Object.keys(ret).reduce(function(tr, k) {
      var t = ret[k];
      if (t && t.length > 0) {
        tr[k] = t;
      }
      return tr;
    }, {});
    return result;
  }

  function onAuthEvent() {
    emitChange({ changed: 'loading', loading: 'ship' });
    Hull.api(Ship.id, { fields: 'badge' }).then(function(ship) {
      initState(Hull.currentUser(), ship);
      if (autoPlay && userCanPlay()) play();
      autoPlay = false;
    }, function(err) {
      emitChange({ error_message: 'ship_not_found', error: err });
    });
  }

  Hull.on('hull.user.update', onAuthEvent);
  Hull.on('hull.user.login', onAuthEvent);
  Hull.on('hull.user.logout', onAuthEvent);
  Hull.on('hull.user.fail', onAuthEvent);

  var _listeners = [];

  // Public API

  this.onChange = function(cb) {
    var callback = function() {
      var args = [].slice.call(arguments);
      setTimeout(function() {
        cb.apply(undefined, args);
      })
    };
    _listeners.push(callback);
    Hull.on(CHANGE_EVENT, callback);
  };

  this.teardown = function() {
    Hull.off('hull.user.update', onAuthEvent);
    Hull.off('hull.user.login', onAuthEvent);
    Hull.off('hull.user.logout', onAuthEvent);
    Hull.off('hull.user.fail', onAuthEvent);
    for (var l = 0; l < _listeners.length; l++) {
      Hull.off(CHANGE_EVENT, listeners[l]);
    }
  };

  this.getState = function() {
    return getAppState();
  };

  this.play = play;
  this.reset = reset;
  this.submitForm = submitForm;
  this.translate = translate;

  if (Ship) {
    initState(CurrentUser, Ship);
  }

  window.addEventListener("message", function(e) {
    var message = e.data;
    if (message && message.event === "ship.update") {
      updateSettings(message.ship.settings);
      updateTranslations(message.ship.translations || {});
    }
  }, false);
};

InstantWin.Steps = Steps;

module.exports = InstantWin;
