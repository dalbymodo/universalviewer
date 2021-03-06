import BaseCommands = require("./modules/uv-shared-module/BaseCommands");
import BootstrapParams = require("BootstrapParams");
import IExtension = require("./modules/uv-shared-module/IExtension");

// The Bootstrapper is concerned with loading the manifest/collection (iiifResource)
// then determining which extension to use and instantiating it.
class Bootstrapper{

    config: any;
    extension: IExtension;
    extensions: IExtension[];
    iiifResource: Manifesto.IIIIFResource;
    isFullScreen: boolean = false;
    manifest: Manifesto.IManifest;
    params: BootstrapParams;
    socket: any;

    constructor(extensions: any) {
        this.extensions = extensions;
    }

    bootStrap(params?: BootstrapParams): void {

        this.params = new BootstrapParams();

        // merge new params
        if (params){
            this.params = $.extend(true, this.params, params);
        }

        // empty app div
        $('#app').empty();

        //// add loading class
        //$('#app').addClass('loading');

        // remove any existing css
        $('link[type*="text/css"]').remove();

        jQuery.support.cors = true;

        this.loadIIIFResource();
    }

    isCORSEnabled(): boolean {
        // No jsonp setting? Then use autodetection. Otherwise, use explicit setting.
        return (null === this.params.jsonp) ? Modernizr.cors : !this.params.jsonp;
    }

    loadIIIFResource(): void{
        var that = this;

        if (this.isCORSEnabled()){
            $.getJSON(that.params.manifestUri, (r) => {
                this.iiifResource = that.parseIIIFResource(JSON.stringify(r));
                this.loadResource();
            });
        } else {
            // use jsonp
            var settings: JQueryAjaxSettings = <JQueryAjaxSettings>{
                url: that.params.manifestUri,
                type: 'GET',
                dataType: 'jsonp',
                jsonp: 'callback',
                jsonpCallback: 'manifestCallback'
            };

            $.ajax(settings);

            window.manifestCallback = (r: any) => {
                this.iiifResource = that.parseIIIFResource(JSON.stringify(r));
                this.loadResource();
            };
        }
    }

    parseIIIFResource(data: string): Manifesto.IIIIFResource {
        return manifesto.create(data,
            <Manifesto.IManifestoOptions>{
                locale: this.params.localeName
            });
    }

    loadResource(): void {

        var manifest: Manifesto.IManifest;

        if (this.iiifResource.getIIIFResourceType().toString() === manifesto.IIIFResourceType.collection().toString()){
            // if it's a collection and has child collections, get the collection by index
            if ((<Manifesto.ICollection>this.iiifResource).collections && (<Manifesto.ICollection>this.iiifResource).collections.length){
                var collection = (<Manifesto.ICollection>this.iiifResource).collections[this.params.collectionIndex];

                if (!collection){
                    this.notFound();
                    return;
                }

                manifest = collection.getManifestByIndex(this.params.manifestIndex);
            } else {
                manifest = (<Manifesto.ICollection>this.iiifResource).getManifestByIndex(this.params.manifestIndex);
            }
        } else {
            manifest = <Manifesto.IManifest>this.iiifResource;
        }

        if (!manifest){
            this.notFound();
            return;
        }

        manifest.load().then((m: Manifesto.IManifest) => {
            this.manifestLoaded(m);
        });
    }

    manifestLoaded(manifest: Manifesto.IManifest): void {

        this.manifest = manifest;

        var sequence: Manifesto.ISequence;
        var canvas: Manifesto.ICanvas;
        var extension: IExtension;

        sequence = this.manifest.getSequenceByIndex(this.params.sequenceIndex);

        if (!sequence){
            this.notFound();
            return;
        }

        canvas = sequence.getCanvasByIndex(this.params.canvasIndex);

        if (!canvas){
            this.notFound();
            return;
        }

        var canvasType = canvas.getType();

        // try using canvasType
        extension = this.extensions[canvasType.toString()];

        // if there isn't an extension for the canvasType, try the format
        if (!extension){
            var format = canvas.getProperty('format');
            extension = this.extensions[format];
        }

        this.featureDetect(() => {
            this.configure(extension, (config) => {
                this.injectCss(extension, config, () => {
                    this.createExtension(extension, config);
                });
            });
        });
    }

    notFound(): void{
        try{
            parent.$(parent.document).trigger(BaseCommands.NOT_FOUND);
            return;
        } catch (e) {}
    }

    featureDetect(cb: () => void): void {
        yepnope({
            test: window.btoa && window.atob,
            nope: 'lib/base64.min.js',
            complete: function () {
                cb();
            }
        });
    }

    configure(extension, cb: (config: any) => void): void {
        var that = this;

        this.getConfigExtension(extension, (configExtension: any) => {
            // todo: use a compiler flag when available
            var configPath = (window.DEBUG)? 'extensions/' + extension.name + '/build/' + that.params.getLocaleName() + '.config.json' : 'lib/' + extension.name + '.' + that.params.getLocaleName() + '.config.json';

            $.getJSON(configPath, (config) => {

                config.name = extension.name;

                // if data-config has been set, extend the existing config object.
                if (configExtension){
                    // save a reference to the config extension uri.
                    config.uri = that.params.config;

                    $.extend(true, config, configExtension);
                }

                cb(config);
            });
        });
    }

    getConfigExtension(extension: any, cb: (configExtension: any) => void): void {

        var sessionConfig = sessionStorage.getItem(extension.name + '.' + this.params.localeName);

        if (sessionConfig) { // if config is stored in sessionstorage
            cb(JSON.parse(sessionConfig));
        } else if (this.params.config){ // if data-config has been set
            $.getJSON(this.params.config, (configExtension) => {
                cb(configExtension);
            });
        } else {
            cb(null);
        }
    }

    injectCss(extension: any, config: any, cb: () => void): void {
        // todo: use a compiler flag when available
        var cssPath = (window.DEBUG)? 'extensions/' + extension.name + '/build/' + config.options.theme + '.css' : 'themes/' + config.options.theme + '/css/' + extension.name + '/theme.css';

        yepnope.injectCss(cssPath, function () {
            cb();
        });
    }

    createExtension(extension: any, config: any): void{

        this.config = config;

        var provider = new extension.provider(this);

        this.extension = new extension.type(this);
        this.extension.name = extension.name;
        this.extension.provider = provider;
        this.extension.create();
    }
}

export = Bootstrapper;