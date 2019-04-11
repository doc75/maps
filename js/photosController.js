function PhotosController (optionsController, timeFilterController) {
    this.PHOTO_MARKER_VIEW_SIZE = 40;
    this.photosDataLoaded = false;
    this.photosRequestInProgress = false;
    this.optionsController = optionsController;
    this.timeFilterController = timeFilterController;
    this.photoMarkers = [];
    this.photoMarkersOldest = null;
    this.photoMarkersNewest = null;
    this.photoMarkersFirstVisible = 0;
    this.photoMarkersLastVisible = -1;
    this.timeFilterBegin = 0;
    this.timeFilterEnd = Date.now();
}

PhotosController.prototype = {

    initLayer : function(map) {
        this.map = map;
        var that = this;
        this.photoLayer = L.markerClusterGroup({
            iconCreateFunction : this.getClusterIconCreateFunction(),
            showCoverageOnHover : false,
            zoomToBoundsOnClick: false,
            maxClusterRadius: this.PHOTO_MARKER_VIEW_SIZE + 10,
            icon: {
                iconSize: [this.PHOTO_MARKER_VIEW_SIZE, this.PHOTO_MARKER_VIEW_SIZE]
            }
        });
        this.photoLayer.on('click', this.getPhotoMarkerOnClickFunction());
        this.photoLayer.on('clusterclick', function (a) {
            if (a.layer.getChildCount() > 20) {
                a.layer.zoomToBounds();
            }
            else {
                a.layer.spiderfy();
            }
        });
        // click on photo menu entry
        $('body').on('click', '#togglePhotosButton, #navigation-photos > a', function(e) {
            that.toggleLayer();
            that.optionsController.saveOptionValues({photosLayer: that.map.hasLayer(that.photoLayer)});
        });
        // click on menu button
        $('body').on('click', '.photosMenuButton', function(e) {
            var wasOpen = $(this).parent().parent().parent().find('>.app-navigation-entry-menu').hasClass('open');
            $('.app-navigation-entry-menu.open').removeClass('open');
            if (!wasOpen) {
                $(this).parent().parent().parent().find('>.app-navigation-entry-menu').addClass('open');
            }
        });
    },

    updateMyFirstLastDates: function() {
        var firstVisible = this.photoMarkersFirstVisible;
        var lastVisible = this.photoMarkersLastVisible;
        var layerVisible = this.map.hasLayer(this.photoLayer);
        this.photoMarkersOldest = layerVisible ? this.photoMarkers[firstVisible].data.date : null;
        this.photoMarkersNewest = layerVisible ? this.photoMarkers[lastVisible].data.date : null;
    },

    showLayer: function() {
        if (!this.photosDataLoaded && !this.photosRequestInProgress) {
            this.callForImages();
        }
        if (!this.map.hasLayer(this.photoLayer)) {
            this.map.addLayer(this.photoLayer);
        }
    },

    hideLayer: function() {
        if (this.map.hasLayer(this.photoLayer)) {
            this.map.removeLayer(this.photoLayer);
        }
    },

    toggleLayer: function() {
        if (this.map.hasLayer(this.photoLayer)) {
            this.hideLayer();
            // color of the eye
            $('#togglePhotosButton button').addClass('icon-toggle').attr('style', '');
        } else {
            this.showLayer();
            // color of the eye
            var color = OCA.Theming.color.replace('#', '');
            var imgurl = OC.generateUrl('/svg/core/actions/toggle?color='+color);
            $('#togglePhotosButton button').removeClass('icon-toggle').css('background-image', 'url('+imgurl+')');
        }
    },

    getPhotoMarkerOnClickFunction: function() {
        var _app = this;
        return function(evt) {
            var marker = evt.layer;
            var galleryUrl = OC.generateUrl('/apps/gallery/#'+encodeURIComponent(marker.data.path.replace(/^\//, '')));
            var win = window.open(galleryUrl, '_blank');
            if (win) {
                win.focus();
            }
        };
    },

    //getPhotoMarkerOnClickFunction() {
    //    var _app = this;
    //    return function(evt) {
    //        var marker = evt.layer;
    //        var content;
    //        if (marker.data.hasPreview) {
    //            var previewUrl = _app.generatePreviewUrl(marker.data.path);
    //            var img = '<img src=' + previewUrl + '/>';
    //            //Workaround for https://github.com/Leaflet/Leaflet/issues/5484
    //            $(img).on('load', function() {
    //                marker.getPopup().update();
    //            });
    //            content = img;
    //        } else {
    //            content = marker.data.path;
    //        }
    //        marker.bindPopup(content, {
    //            className: 'leaflet-popup-photo',
    //            maxWidth: 'auto'
    //        }).openPopup();
    //    }
    //},

    getClusterIconCreateFunction: function() {
        var _app = this;
        return function(cluster) {
            var marker = cluster.getAllChildMarkers()[0].data;
            var iconUrl;
            if (marker.hasPreview) {
                iconUrl = _app.generatePreviewUrl(marker.path);
            } else {
                iconUrl = _app.getImageIconUrl();
            }
            var label = cluster.getChildCount();
            return new L.DivIcon(L.extend({
                className: 'leaflet-marker-photo cluster-marker',
                html: '<div class="thumbnail" style="background-image: url(' + iconUrl + ');"></div>​<span class="label">' + label + '</span>'
            }, this.icon));
        };
    },

    createPhotoView: function(markerData) {
        var iconUrl;
        if (markerData.hasPreview) {
            iconUrl = this.generatePreviewUrl(markerData.path);
        } else {
            iconUrl = this.getImageIconUrl();
        }
        return L.divIcon(L.extend({
            html: '<div class="thumbnail" style="background-image: url(' + iconUrl + ');"></div>​',
            className: 'leaflet-marker-photo photo-marker'
        }, markerData, {
            iconSize: [this.PHOTO_MARKER_VIEW_SIZE, this.PHOTO_MARKER_VIEW_SIZE],
            iconAnchor:   [this.PHOTO_MARKER_VIEW_SIZE / 2, this.PHOTO_MARKER_VIEW_SIZE]
        }));
    },

    addPhotosToMap : function(photos) {
        var markers = this.preparePhotoMarkers(photos);
        this.photoMarkers.push.apply(this.photoMarkers, markers);
        this.photoMarkers.sort(function (a, b) { return a.data.date - b.data.date;});

        // we put them all in the layer
        this.photoMarkersFirstVisible = 0;
        this.photoMarkersLastVisible = this.photoMarkers.length - 1;
        this.photoLayer.addLayers(this.photoMarkers);

        this.updateTimeFilterRange();
        this.timeFilterController.setSliderToMaxInterval();
    },

    preparePhotoMarkers : function(photos) {
        var markers = [];
        for (var i = 0; i < photos.length; i++) {
            var markerData = {
                lat: photos[i].lat,
                lng: photos[i].lng,
                path: photos[i].path,
                albumId: photos[i].folderId,
                hasPreview : photos[i].hasPreview,
                date: photos[i].dateTaken
            };
            var marker = L.marker(markerData, {
                icon: this.createPhotoView(markerData)
            });
            marker.data = markerData;
            var previewUrl = this.generatePreviewUrl(marker.data.path);
            var date = new Date(photos[i].dateTaken*1000);
            var img = '<img class="photo-tooltip" src=' + previewUrl + '/>' +
                '<p class="tooltip-photo-name">' + escapeHTML(basename(markerData.path)) + '</p>' +
                '<p class="tooltip-photo-name">' + date.toIsoString() + '</p>';
            marker.bindTooltip(img, {permanent: false, className: "leaflet-marker-photo-tooltip"});
            markers.push(marker);
        }
        return markers;
    },

    updateTimeFilterRange: function() {
        this.updateMyFirstLastDates();
        this.timeFilterController.updateSliderRangeFromController();
    },

    updateTimeFilterBegin: function (date) {
        if (date <= this.timeFilterEnd) {
            var i = this.photoMarkersFirstVisible;
            if (date < this.timeFilterBegin) {
                i = i-1;
                while (i >= 0 && i <= this.photoMarkersLastVisible && this.photoMarkers[i].data.date >= date) {
                    this.photoLayer.addLayer(this.photoMarkers[i]);
                    i = i-1;
                }
                this.photoMarkersFirstVisible = i + 1;
            }
            else {
                while (i < this.photoMarkers.length && i >= 0 && i <= this.photoMarkersLastVisible && this.photoMarkers[i].data.date < date) {
                    this.photoLayer.removeLayer(this.photoMarkers[i]);
                    i = i + 1;
                }
                this.photoMarkersFirstVisible = i;
            }
            this.timeFilterBegin = date;
        }
        else {
            this.updateTimeFilterBegin(this.timeFilterEnd);
        }
    },

    updateTimeFilterEnd: function (date){
        if (date >= this.timeFilterBegin) {
            var i = this.photoMarkersLastVisible;
            if (date < this.timeFilterEnd) {
                while (i >= 0 && i >= this.photoMarkersFirstVisible && this.photoMarkers[i].data.date > date ) {
                    this.photoLayer.removeLayer(this.photoMarkers[i]);
                    i = i-1;
                }
                this.photoMarkersLastVisible = i;
            }
            else {
                i = i+1;
                while (i >= this.photoMarkersFirstVisible && i < this.photoMarkers.length && this.photoMarkers[i].data.date <= date) {
                    this.photoLayer.addLayer(this.photoMarkers[i]);
                    i = i+1;
                }
                this.photoMarkersLastVisible = i - 1;
            }
            this.timeFilterEnd = date;
        }
        else {
            this.updateTimeFilterEnd(this.timeFilterBegin);
        }
    },

    callForImages: function() {
        this.photosRequestInProgress = true;
        $('#navigation-photos').addClass('icon-loading-small');
        $.ajax({
            url: OC.generateUrl('apps/maps/photos'),
            type: 'GET',
            async: true,
            context: this
        }).done(function (response) {
            if (response.length == 0) {
                //showNoPhotosMessage();
            }
            else {
                this.addPhotosToMap(response);
            }
            this.photosDataLoaded = true;
        }).always(function (response) {
            this.photosRequestInProgress = false;
            $('#navigation-photos').removeClass('icon-loading-small');
        }).fail(function() {
            OC.Notification.showTemporary(t('maps', 'Failed to load photos'));
        });
    },

    /* Preview size 32x32 is used in files view, so it sould be generated */
    generateThumbnailUrl: function (filename) {
        return OC.generateUrl('core') + '/preview.png?file=' + encodeURI(filename) + '&x=32&y=32';
    },

    /* Preview size 375x211 is used in files details view */
    generatePreviewUrl: function (filename) {
        return OC.generateUrl('core') + '/preview.png?file=' + encodeURI(filename) + '&x=349&y=349&a=1';
    },

    getImageIconUrl: function() {
        return OC.generateUrl('/apps/theming/img/core/filetypes') + '/image.svg?v=2';
    },

    contextPlacePhotos: function(e) {
        var that = this.photosController;
        var latlng = e.latlng;
        OC.dialogs.filepicker(
            t('maps', 'Choose pictures to place'),
            function(targetPath) {
                that.placePhotos(targetPath, [latlng.lat], [latlng.lng]);
            },
            true,
            ['image/jpeg', 'image/tiff'],
            true
        );
    },

    contextPlacePhotoFolder: function(e) {
        var that = this.photosController;
        var latlng = e.latlng;
        OC.dialogs.filepicker(
            t('maps', 'Choose directory of pictures to place'),
            function(targetPath) {
                if (targetPath === '') {
                    targetPath = '/';
                }
                that.placePhotos([targetPath], latlng.lat, latlng.lng, true);
            },
            false,
            'httpd/unix-directory',
            true
        );
    },

    placePhotos: function(paths, lats, lngs, directory=false) {
        var that = this;
        $('#navigation-photos').addClass('icon-loading-small');
        $('.leaflet-container').css('cursor', 'wait');
        var req = {
            paths: paths,
            lats: lats,
            lngs: lngs,
            directory: directory
        };
        var url = OC.generateUrl('/apps/maps/photos');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            OC.Notification.showTemporary(t('maps', '{nb} photos placed', {nb: response}));
            if (response > 0) {
                that.photosDataLoaded = false;
                for (var i=0; i < that.photoMarkers.length; i++) {
                    that.photoLayer.removeLayer(that.photoMarkers[i]);
                }
                that.photoMarkers = [];
                that.photoMarkersOldest = null;
                that.photoMarkersNewest = null;
                that.photoMarkersFirstVisible = 0;
                that.photoMarkersLastVisible = -1;
                that.timeFilterBegin = 0;
                that.timeFilterEnd = Date.now();

                that.showLayer();
            }
        }).always(function (response) {
            $('#navigation-photos').removeClass('icon-loading-small');
            $('.leaflet-container').css('cursor', 'grab');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('maps', 'Failed to place photos') + ': ' + response.responseText);
        });
    },

};

