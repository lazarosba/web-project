const express = require('express');
const db = require('./config');
const path = require('path');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');


const app = express();
const PORT = 3000;
const SECRET_KEY = 'your-secret-key';


// Έλεγχος σύνδεσης με τη βάση δεδομένων
db.query('SELECT 1', (err, results) => {
    if (err) {
        console.error('Database connection failed:', err);
        process.exit(1); // Τερματισμός του server αν η σύνδεση αποτύχει
    } else {
        console.log('Database connected successfully!');
    }
});


// Ορισμός του index file και των public αρχειων
app.use(express.static('public', {
index: 'index.html' // Ορισμός του index για το static
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Middleware για έλεγχο JWT
app.use(cookieParser());
const authenticateJWT = (req, res, next) => {
    const token = req.cookies?.token ||  req.headers.authorization?.split(' ')[1]; // Παίρνει το token από το header ή απο το cookie. Στη περιπτωση μας, απο το cookie. 

    if (!token) {
        console.log('No token found.');
        return res.status(401).send('Access denied');
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            console.log('Token not verified.');
            return res.status(403).send('Invalid token');
        }

        req.user = user; // Αποθηκεύουμε τα δεδομένα του χρήστη στο request
        next();
    });
};

const authorizeRole = (requiredRole) => {
    return (req, res, next) => {
        if (req.user.role !== requiredRole) {
            return res.status(403).send('Access denied');
        }
        next();
    };
};

// Route για το /login και /login.html
app.get('/login', (req, res) => {
    const token = req.cookies?.token;

    if (token) {
        // Αν υπάρχει token, επαληθεύουμε
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (!err && user) {
                // Αν ο χρήστης είναι έγκυρος, ανακατεύθυνση στη σελίδα του
                return res.redirect(user.role === 'professor' ? '/teacher' : '/student');
            }
        });
    }

    // Αν δεν υπάρχει token ή είναι μη έγκυρο, εμφανίζουμε το login.html
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});




// Login endpoint
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send('Email and password are required');
    }

    const query = `
        SELECT * FROM (
            SELECT id, email, password, 'student' AS role FROM students
            UNION ALL
            SELECT id, email, password, 'professor' AS role FROM professors
        ) AS users
        WHERE email = ? AND password = ?;
    `;

    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server error');
        }

        if (results.length > 0) {
            const user = results[0];
            const token = jwt.sign(
                { userId: user.id, role: user.role },
                SECRET_KEY,
                { expiresIn: '1h' } // Το token λήγει σε 1 ώρα
            );

            // Αποθήκευση του token σε cookie για εύκολη χρήση
            res.cookie('token', token, { httpOnly: true });

            // Ανακατεύθυνση με βάση τον ρόλο
            if (user.role === 'professor') {
                return res.redirect('/teacher');
            } else if (user.role === 'student') {
                return res.redirect('/student');
            }
        } else {
            res.status(401).send('Invalid credentials');
        }
    });
});


// Προστατευμένα endpoints για διπλωματικές
app.get('/api/theses', authenticateJWT, (req, res) => {
    const professorId = req.user.userId;
    const query = `SELECT * FROM THESIS WHERE teacher_id = ?;`;

    db.query(query, [professorId], (err, results) => {
        if (err) {
            console.error('Σφάλμα κατά την ανάκτηση των διπλωματικών:', err);
            return res.status(500).json({ success: false, message: 'Σφάλμα στον server' });
        }

        res.status(200).json({ success: true, theses: results });
    });
});

app.post('/api/theses/new', authenticateJWT, (req, res) => {
    const { title, summary } = req.body;
    const professorId = req.user.userId;

    if (!title || !summary) {
        return res.status(400).json({ success: false, message: 'Title and summary are required' });
    }

    const query = `INSERT INTO THESIS (teacher_id, title, summary) VALUES (?, ?, ?);`;

    db.query(query, [professorId, title, summary], (err, result) => {
        if (err) {
            console.error('Σφάλμα κατά την αποθήκευση της διπλωματικής:', err);
            return res.status(500).json({ success: false, message: 'Σφάλμα στον server' });
        }

        console.log('Thesis created successfully!');
        return res.status(201).json({ success: true, message: 'Η διπλωματική δημιουργήθηκε επιτυχώς!' });
    });
});


// Προστατευμένα routes για καθηγητές και φοιτητές
    // Σελίδα για καθηγητές
app.get('/teacher', authenticateJWT, authorizeRole('professor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'protected_views', 'teacher.html'));
});

    // Σελίδα για φοιτητές
app.get('/student', authenticateJWT, authorizeRole('student'), (req, res) => {
    res.sendFile(path.join(__dirname, 'protected_views', 'student.html'));
});

// Logout endpoint
app.post('/logout', authenticateJWT, (req, res) => {
    // Καθαρισμός του cookie που περιέχει το JWT
    res.clearCookie('token', { httpOnly: true });
    // Ανακατεύθυνση στο index
    res.redirect('/');
});



// Endpoint για την ανάρτηση PDF αρχείων με χρήση multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Αποθήκευση στο φάκελο uploads
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Unique filename
    }
});

// Φίλτρο για την ανάρτηση μόνο PDF αρχείων και όχι άλλων τύπων
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true); // Αποδοχή
    } else {
        cb(new Error('Only PDF files are allowed'), false); // Άρνηση
    }
};

// Αρχικοποίηση multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 25 * 1024 * 1024 // Μέγιστο μέγεθος αρχείου: 25MB
    }
});

//Endpoint ανάρτησης
app.post('/upload', upload.single('pdf'), (req, res) => {
    // Check if a file was uploaded
    if (!req.file) {
        return res.status(400).send('No file uploaded or invalid file type');
    }

    // Respond with success message and file information
    res.status(200).json({
        message: 'File uploaded successfully!',
        file: {
            filename: req.file.filename,
            path: req.file.path
        }
    });
});



// Εκκίνηση του server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
