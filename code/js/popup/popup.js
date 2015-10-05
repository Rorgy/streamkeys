"use strict";

var $ = require("jquery"),
    ko = require("ko"),
    _ = require("lodash");
require("../lib/jquery.marquee.js");

var PopupViewModel = function PopupViewModel() {
  var self = this;

  self.totalMusicTabs = ko.observable(1);
  self.musicTabsLoaded = ko.observable(0);
  self.musicTabs = ko.observableArray([]);
  self.hasDefaultTab = ko.observable(false);

  // Filter hidden players and sort by siteName -> tabId
  self.sortedMusicTabs = ko.computed(function() {
    return _.sortByAll(
      _.filter(self.musicTabs(), (tab) => (tab.canPlayPause() || !tab.hidePlayer) ),
      ["siteName", "tabId"]
    );
  });

  self.isLoaded = ko.computed(() => (self.musicTabsLoaded() == self.totalMusicTabs()) );

  self.visibleMusicTabs = ko.observableArray([]);
  self.optionsUrl = ko.observable(chrome.runtime.getURL("html/options.html"));

  // Send a request to get the player state of every active music site tab
  chrome.runtime.sendMessage({ action: "get_music_tabs" }, self.getTabStates.bind(this));

  // Setup listener for updating the popup state
  chrome.runtime.onMessage.addListener(function(request) {
    if(request.action === "update_popup_state" && request.stateData) self.updateState(request.stateData, request.fromTab);
    if(request.action === "default_tab_changed") {
      console.log("from bg: ", request.tabId);
      // Update the default tab state for _all_ music tabs
      // Do this to reset previous default vals because click on default btn
      // only sends message to background & does not change the observable
      _.each(self.musicTabs(), (tab) => tab.defaultTab(tab.tabId == request.tabId) );
      self.hasDefaultTab(!_.isNull(request.tabId));
    }
  });
};

PopupViewModel.prototype.updateState = function(stateData, tab) {
  if(_.isUndefined(stateData)) return false;

  var musicTab = _.findWhere(this.musicTabs(), { tabId: tab.id });

  if(musicTab) {
    // Update observables
    _.forEach(musicTab.observableProperties, function(property) {
      if(!_.isUndefined(stateData[property])) musicTab[property](stateData[property]);
    });
  } else {
    musicTab = new MusicTab(_.assign(stateData, {
      tabId: tab.id,
      faviconUrl: tab.favIconUrl,
      streamkeysEnabled: _.isUndefined(tab.streamkeysEnabled) ? true : tab.streamkeysEnabled
    }));

    this.musicTabs.push(musicTab);
  }
};

/**
 * Query each active music tab for the player state, then update the popup state
 * @param {Array} tabs - array of active music tabs
 */
PopupViewModel.prototype.getTabStates = function(tabs) {
  var self = this;
  self.totalMusicTabs(tabs.length);
  self.hasDefaultTab(_.some(tabs, (tab) => tab.defaultTab ));

  _.forEach(tabs, function(tab) {
    console.log("tab state: ", tab);
    chrome.tabs.sendMessage(tab.id, { action: "getPlayerState" }, (function(playerState) {
      self.updateState(_.assign(playerState, { defaultTab: tab.defaultTab }), this.tab);
      self.musicTabsLoaded(self.musicTabsLoaded.peek() + 1);
    }).bind({ tab: tab }));
  });
};

var MusicTab = (function() {
  function MusicTab(attributes) {
    var self = this;

    self.observableProperties = [
      "song",
      "artist",
      "streamkeysEnabled",
      "defaultTab",
      "isPlaying",
      "canPlayPause",
      "canPlayNext",
      "canPlayPrev",
      "canLike",
      "canDislike"
    ];

    _.assign(self, attributes);

    /** Override observables **/
    _.forEach(self.observableProperties, function(property) {
      self[property] = ko.observable(_.isUndefined(attributes[property]) ? null : attributes[property]);
    });

    /** Popup specific observables **/
    self.showTabSettings = ko.observable(false);

    self.songArtistText = ko.pureComputed(function() {
      if(!self.song()) return "";

      return (self.artist()) ? self.artist() + " - " + self.song() : self.song();
    });

    self.defaultTab.subscribe((val) => console.log("default tab changeD: ", val) );

    self.setDefaultTab = function(set) {
      console.log("Default tab changed: ", self.tabId, set);
      if(set) {
        chrome.runtime.sendMessage({
          action: "set_default_tab",
          tabId: self.tabId
        });
      } else {
        chrome.runtime.sendMessage({
          action: "unset_default_tab"
        });
      }
    };

    self.sendAction = function(action) {
      chrome.runtime.sendMessage({
        action: "command",
        command: action,
        tabTarget: self.tabId
      });
    };

    self.openTab = function() {
      chrome.tabs.update(parseInt(self.tabId), { selected: true });
    };

    self.toggleStreamkeysEnabled = function() {
      self.streamkeysEnabled(!self.streamkeysEnabled.peek());
      chrome.extension.getBackgroundPage().window.sk_sites.markTabEnabledState(self.tabId, self.streamkeysEnabled.peek());
    };
  }

  return MusicTab;
})();

document.addEventListener("DOMContentLoaded", function() {
  window.popup = new PopupViewModel();
  ko.applyBindings(window.popup);

  ko.bindingHandlers.scrollingSong = {
    update: function(element, valueAccessor) {
      $(element).text(ko.unwrap(valueAccessor()));
      if($(element).outerWidth() > $("#player").width()) {
        // Remove any old marquees
        $(element).marquee("destroy");
        var scrollDuration = (parseInt($(element).outerWidth()) * 15);

        $(element).bind("finished", function() {
          $(this).find(".js-marquee-wrapper").css("margin-left", "0px");
        }).marquee({
          allowCss3Support: false,
          delayBeforeStart: 2500,
          duration: scrollDuration,
          pauseOnCycle: true
        });
      }
    }
  };
});
