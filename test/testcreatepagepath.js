var phantom=require('../node-phantom-ws');

exports.testPhantomCreatePagePath=function(beforeExit,assert) {
	phantom.create(function(error,ph){
		assert.isNotNull(error);
	},{phantomPath:'@@@'});
};
