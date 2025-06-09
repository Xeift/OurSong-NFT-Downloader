import requests
from flask import Blueprint, jsonify, send_file, request
from utils.download_oursong_data import *

oursong_data_blueprint = Blueprint('oursong_data_blueprint', __name__)

@oursong_data_blueprint.route('/api/oursong-data-download', methods=['GET'])
def download_oursong_data():
    type = request.args.get('type')
    creator_ids = request.args.getlist('creator_id')

    print(type, creator_ids)
    if type == 'json':
        download_creator_data_as_json(creator_ids)
        return send_file('data.json', as_attachment=True)

    elif type == 'xlsx':
        download_creator_data_as_json(creator_ids)
        xlsx_converter()
        return send_file('data.xlsx', as_attachment=True)



