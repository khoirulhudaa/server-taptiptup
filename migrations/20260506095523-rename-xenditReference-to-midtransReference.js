'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.renameColumn(
      'Withdrawals',           // nama tabel (perhatikan huruf besar/kecil)
      'xenditReference',       // nama kolom lama
      'midtransReference'      // nama kolom baru
    );
  },

  async down(queryInterface, Sequelize) {
    // Rollback: balik ke nama lama
    await queryInterface.renameColumn(
      'Withdrawals',
      'midtransReference',
      'xenditReference'
    );
  }
}