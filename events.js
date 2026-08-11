// Petit "haut-parleur" interne partagé entre les routes admin et client,
// utilisé pour prévenir un client en temps réel quand un point lui est ajouté.
const { EventEmitter } = require('events');

const pointsEmitter = new EventEmitter();
pointsEmitter.setMaxListeners(0);

module.exports = pointsEmitter;
