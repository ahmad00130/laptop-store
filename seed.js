const db = require('./db');

const count = db.prepare('SELECT COUNT(*) AS total FROM laptops').get().total;

if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO laptops
      (brand, model, processor, ram_gb, storage_gb, storage_type, screen_size,
       battery_health, condition, price, discount_percent, image, stock, use_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const laptops = [
    ['HP', 'EliteBook 840 G5', 'Intel Core i5-8350U', 8, 256, 'SSD', 14, '85%', 'Used', 280000, 10, '', 3, 'school,office,light'],
    ['Dell', 'Latitude 7490', 'Intel Core i7-8650U', 16, 512, 'SSD', 14, '80%', 'Used', 350000, 5, '', 2, 'programming,office,school'],
    ['Lenovo', 'ThinkPad T480', 'Intel Core i5-8250U', 16, 256, 'SSD', 14, '82%', 'Refurbished', 320000, 8, '', 4, 'programming,school,office'],
    ['Apple', 'MacBook Pro 2019', 'Intel Core i7', 16, 512, 'SSD', 15.4, '88%', 'Used', 650000, 0, '', 1, 'video-editing,design,programming'],
    ['Asus', 'ROG Strix G15', 'AMD Ryzen 7 5800H', 16, 512, 'SSD', 15.6, '90%', 'Used', 720000, 12, '', 2, 'gaming,video-editing'],
    ['HP', 'Pavilion 15', 'Intel Core i3-1005G1', 4, 1000, 'HDD', 15.6, '75%', 'Used', 150000, 15, '', 5, 'school,light'],
    ['Dell', 'XPS 15 9570', 'Intel Core i7-8750H', 32, 1000, 'SSD', 15.6, '85%', 'Used', 800000, 10, '', 1, 'video-editing,design,gaming,programming'],
  ];

  for (const laptop of laptops) {
    insert.run(...laptop);
  }

  console.log('Sample laptops added.');
} else {
  console.log('Database already has laptops. Nothing added.');
}

// Show what is in the database, with the final price after discount
const rows = db.prepare('SELECT * FROM laptops').all();

console.log('\nLaptops in database:\n');
for (const l of rows) {
  const finalPrice = l.price - (l.price * l.discount_percent) / 100;
  console.log(
    `#${l.id} ${l.brand} ${l.model} | ${l.ram_gb}GB RAM | ${l.storage_gb}GB ${l.storage_type} | ` +
    `N${l.price.toLocaleString()} -${l.discount_percent}% = N${finalPrice.toLocaleString()}`
  );
}