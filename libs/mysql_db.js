var mysql      = require('mysql');

const { sql_host, sql_user, sql_password, sql_db, sql_port } = require('../config.json');

var connection = mysql.createPool({ //mysql.createConnection({
	connectionLimit : 3,
	host     : sql_host,
	port     : sql_port,
	user     : sql_user,
	password : sql_password,
	database : sql_db
});

/*connection.connect((err) => {
	if (err) {
		console.error('error connecting: ' + err.stack);
		return;
	}

	console.log('> connected to MySQL successfully');
});*/


global.Botto.DB = connection