import requests
from flask import Blueprint, render_template

oursong_blueprint = Blueprint('oursong_blueprint', __name__)

@oursong_blueprint.route('/oursong-data-download', methods=['GET'])
def oursong_data_download():
    return render_template('oursong-data-download.html')