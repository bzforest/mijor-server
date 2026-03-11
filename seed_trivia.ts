import { connectionPool } from './utils/db';

async function seed() {
    const q = `INSERT INTO trivia_questions (question, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES 
('Which movie holds the record for the highest-grossing film of all time?', 'Avatar', 'Avengers: Endgame', 'Titanic', 'Star Wars: The Force Awakens', 'Avatar', 'easy'),
('What is the name of the hobbit played by Elijah Wood in the Lord of the Rings movies?', 'Frodo Baggins', 'Samwise Gamgee', 'Bilbo Baggins', 'Peregrin Took', 'Frodo Baggins', 'easy'),
('Who directed the movie ''Inception''?', 'Steven Spielberg', 'Christopher Nolan', 'Quentin Tarantino', 'Martin Scorsese', 'Christopher Nolan', 'medium'),
('In ''The Matrix'', what color is the pill Neo takes?', 'Blue', 'Red', 'Green', 'Yellow', 'Red', 'medium'),
('Which movie won the first Academy Award for Best Animated Feature?', 'Toy Story', 'Shrek', 'Spirited Away', 'Finding Nemo', 'Shrek', 'hard'),
('In exactly what year does Marty McFly travel to the future in Back to the Future Part II?', '2015', '2019', '2020', '2023', '2015', 'hard'),
('Which film has the longest runtime of any film to win the Academy Award for Best Picture?', 'Gone with the Wind', 'Lawrence of Arabia', 'The Lord of the Rings: The Return of the King', 'Ben-Hur', 'Gone with the Wind', 'expert'),
('Who was the first female director to win the Academy Award for Best Director?', 'Jane Campion', 'Sofia Coppola', 'Kathryn Bigelow', 'Chloe Zhao', 'Kathryn Bigelow', 'expert')`;

    try {
        await connectionPool.query(q);
        console.log("Seeded trivia questions");
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

seed();
