import mysql from "mysql";
import cfg from "config";

const { host, user, password, db, port } = cfg.get("mysql") as any;

export var connection = mysql.createPool({
	connectionLimit : 3,
	host     : host,
	port     : Number(port),
	user     : user,
	password : password,
	database : db
});